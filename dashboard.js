// dashboard.js
// ============================================================
// Main Dashboard Logic — Sewer Pipeline Monitoring System
// Uses Firebase Realtime Database for live updates
// Handles: charts, alerts, thresholds, demo mode, history
// ============================================================

import { initializeApp }   from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getDatabase, ref, onValue, get, push, set, query,
  orderByChild, startAt, endAt, limitToLast
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

import { firebaseConfig }  from "./config/config.js";
import { startDemoSimulation, stopDemoSimulation } from "../functions/demoSimulator.js";

// ─── Firebase Init ────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// ─── Chart Config ─────────────────────────────────────────
const MAX_LIVE_POINTS  = 30;
const CHART_TEAL       = "rgb(13,148,136)";
const CHART_TEAL_FILL  = "rgba(13,148,136,0.1)";
const CHART_ORANGE     = "rgb(249,115,22)";
const CHART_ORANGE_FILL= "rgba(249,115,22,0.1)";

// Rolling chart data buffers
const liveData = {
  labels:   [],
  mh1Level: [], mh2Level: [],
  mh1Flow:  [], mh2Flow:  []
};

// Historical export buffer
let historyBuffer = [];

// Chart instances
let levelChart, flowChart, histLevelChart, histFlowChart;

// Demo interval reference (stored so simulator can cancel)
let isDemoActive = false;

// ─── Threshold System ─────────────────────────────────────
function getThresholds(hour) {
  const T = {
    "0-5":  { level: { n1:10, n2:30, w:40, c:60 }, flow: { n1:5,  n2:20,  w:30,  c:50  } },
    "6-10": { level: { n1:20, n2:60, w:70, c:85 }, flow: { n1:20, n2:80,  w:100, c:130 } },
    "11-16":{ level: { n1:15, n2:50, w:60, c:75 }, flow: { n1:15, n2:60,  w:75,  c:100 } },
    "17-21":{ level: { n1:25, n2:70, w:80, c:90 }, flow: { n1:30, n2:100, w:120, c:150 } },
    "22-23":{ level: { n1:10, n2:40, w:50, c:65 }, flow: { n1:10, n2:40,  w:60,  c:90  } }
  };
  if (hour <= 5)        return T["0-5"];
  if (hour <= 10)       return T["6-10"];
  if (hour <= 16)       return T["11-16"];
  if (hour <= 21)       return T["17-21"];
  return T["22-23"];
}

function evaluateStatus(value, thresholds) {
  if (value >= thresholds.c)  return { key:"critical", label:"Critical", css:"status-critical" };
  if (value >= thresholds.w)  return { key:"warning",  label:"Warning",  css:"status-warning"  };
  return                             { key:"normal",   label:"Normal",   css:"status-normal"   };
}

// ─── Alert Message Builder ─────────────────────────────────
const ALERT_MESSAGES = {
  level: {
    warning:  (id, val) =>
      `Manhole ${id} sewage level is at <strong>${val.toFixed(1)}%</strong>. ` +
      `Approaching capacity threshold — monitor closely for continued rise.`,
    critical: (id, val) =>
      `Manhole ${id} sewage level is critically high at <strong>${val.toFixed(1)}%</strong>. ` +
      `Possible blockage or downstream flow restriction. Immediate inspection required.`
  },
  flow: {
    warning:  (id, val) =>
      `Manhole ${id} flow rate is elevated at <strong>${val.toFixed(1)} L/min</strong>. ` +
      `Exceeds normal range — possible increased network usage or partial obstruction.`,
    critical: (id, val) =>
      `Manhole ${id} flow rate is critically high at <strong>${val.toFixed(1)} L/min</strong>. ` +
      `Risk of overflow or pipe stress. Emergency response may be required.`
  }
};

// ─── Initialise Charts ────────────────────────────────────
function initCharts() {
  const baseOptions = (yLabel, max) => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    animation:   { duration: 200 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#0f172a",
        titleColor: "#94a3b8",
        bodyColor: "#f1f5f9",
        padding: 10,
        cornerRadius: 8
      }
    },
    scales: {
      x: {
        grid: { color: "#f1f5f9" },
        ticks: { color: "#94a3b8", font: { size: 10 }, maxTicksLimit: 8 }
      },
      y: {
        min: 0,
        max: max,
        grid: { color: "#f1f5f9" },
        ticks: {
          color: "#94a3b8",
          font: { size: 10 },
          callback: v => `${v}${yLabel}`
        }
      }
    }
  });

  function makeDS(label, color, fill) {
    return {
      label,
      data: [],
      borderColor: color,
      backgroundColor: fill,
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: color,
      tension: 0.4,
      fill: true
    };
  }

  levelChart = new Chart(
    document.getElementById("levelChart"),
    {
      type: "line",
      data: {
        labels: liveData.labels,
        datasets: [
          makeDS("Manhole 1", CHART_TEAL,   CHART_TEAL_FILL),
          makeDS("Manhole 2", CHART_ORANGE, CHART_ORANGE_FILL)
        ]
      },
      options: baseOptions("%", 100)
    }
  );

  flowChart = new Chart(
    document.getElementById("flowChart"),
    {
      type: "line",
      data: {
        labels: liveData.labels,
        datasets: [
          makeDS("Manhole 1", CHART_TEAL,   CHART_TEAL_FILL),
          makeDS("Manhole 2", CHART_ORANGE, CHART_ORANGE_FILL)
        ]
      },
      options: baseOptions(" L/m", 200)
    }
  );
}

// ─── Update Live Charts ────────────────────────────────────
function pushChartPoint(mh1Level, mh2Level, mh1Flow, mh2Flow) {
  const label = new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });

  const push_ = (arr, val) => {
    arr.push(val);
    if (arr.length > MAX_LIVE_POINTS) arr.shift();
  };

  push_(liveData.labels,   label);
  push_(liveData.mh1Level, mh1Level);
  push_(liveData.mh2Level, mh2Level);
  push_(liveData.mh1Flow,  mh1Flow);
  push_(liveData.mh2Flow,  mh2Flow);

  levelChart.data.labels             = liveData.labels;
  levelChart.data.datasets[0].data   = liveData.mh1Level;
  levelChart.data.datasets[1].data   = liveData.mh2Level;
  levelChart.update("none");

  flowChart.data.labels              = liveData.labels;
  flowChart.data.datasets[0].data    = liveData.mh1Flow;
  flowChart.data.datasets[1].data    = liveData.mh2Flow;
  flowChart.update("none");
}

// ─── Update Metric Card UI ─────────────────────────────────
function updateMetricCard(cardId, valueId, statusId, value, status, decimals = 1) {
  const card   = document.getElementById(cardId);
  const valEl  = document.getElementById(valueId);
  const statEl = document.getElementById(statusId);

  valEl.textContent = isNaN(value) ? "--" : value.toFixed(decimals);

  // Remove old status classes
  card.classList.remove("status-normal", "status-warning", "status-critical");
  card.classList.add(status.key === "normal"
    ? "status-normal"
    : status.key === "warning"
      ? "status-warning"
      : "status-critical"
  );

  statEl.textContent = status.label;
  statEl.className   = `metric-status-badge ${status.css}`;
}

// ─── Update Manhole Card UI ────────────────────────────────
function updateManholeCard(id, data, levelStatus, flowStatus) {
  const n = id;  // "1" or "2"

  // Address & coords (from database, not hardcoded)
  const addrEl   = document.getElementById(`mh${n}Address`);
  const coordsEl = document.getElementById(`mh${n}Coords`);
  const tsEl     = document.getElementById(`mh${n}Timestamp`);
  const lvlPct   = document.getElementById(`mh${n}LevelPct`);
  const lvlBar   = document.getElementById(`mh${n}LevelBar`);
  const flowVal  = document.getElementById(`mh${n}FlowVal`);
  const flowBar  = document.getElementById(`mh${n}FlowBar`);

  if (data.address)     addrEl.textContent   = data.address;
  if (data.coordinates) coordsEl.textContent =
    `${data.coordinates.lat.toFixed(6)}, ${data.coordinates.lng.toFixed(6)}`;
  if (data.timestamp) {
    const d = new Date(data.timestamp);
    tsEl.textContent = isNaN(d.getTime())
      ? data.timestamp
      : d.toLocaleString("en-GB");
  }

  const level = Number(data.level) || 0;
  const flow  = Number(data.flow)  || 0;
  const pct   = Math.min(level, 100);
  const flowPct = Math.min((flow / 200) * 100, 100);

  lvlPct.textContent = `${pct.toFixed(1)}%`;
  lvlBar.style.width = `${pct}%`;

  // Color the level bar by status
  lvlBar.classList.remove("warning", "critical");
  if (levelStatus.key === "warning")  lvlBar.classList.add("warning");
  if (levelStatus.key === "critical") lvlBar.classList.add("critical");

  flowVal.textContent = `${flow.toFixed(1)} L/min`;
  flowBar.style.width = `${flowPct}%`;
}

// ─── Alert Generator ──────────────────────────────────────
function generateAlerts(mh1Data, mh2Data) {
  const hour = new Date().getHours();
  const T    = getThresholds(hour);
  const alerts = [];

  const check = (id, data) => {
    const level     = Number(data.level) || 0;
    const flow      = Number(data.flow)  || 0;
    const lvlStatus = evaluateStatus(level, T.level);
    const flwStatus = evaluateStatus(flow,  T.flow);

    if (lvlStatus.key !== "normal") {
      alerts.push({
        type:    lvlStatus.key,
        message: ALERT_MESSAGES.level[lvlStatus.key](id, level)
      });
    }
    if (flwStatus.key !== "normal") {
      alerts.push({
        type:    flwStatus.key,
        message: ALERT_MESSAGES.flow[flwStatus.key](id, flow)
      });
    }
    return { lvlStatus, flwStatus };
  };

  const s1 = check(1, mh1Data);
  const s2 = check(2, mh2Data);

  return { alerts, s1, s2 };
}

// ─── Render Alerts ────────────────────────────────────────
function renderAlerts(alerts) {
  const section  = document.getElementById("alertsSection");
  const list     = document.getElementById("alertsList");
  const countEl  = document.getElementById("alertsCount");

  if (alerts.length === 0) {
    section.classList.add("hidden");
    return;
  }

  const hasCritical = alerts.some(a => a.type === "critical");

  section.classList.remove("hidden");
  section.classList.toggle("has-critical", hasCritical);
  countEl.textContent = alerts.length;

  list.innerHTML = alerts.map(a => `
    <div class="alert-item ${a.type === "critical" ? "critical" : ""}">
      <span class="alert-badge">${a.type.toUpperCase()}</span>
      <span class="alert-message">${a.message}</span>
    </div>
  `).join("");
}

// ─── Update Footer ─────────────────────────────────────────
function updateLastUpdated() {
  document.getElementById("lastUpdated").textContent =
    `Last updated: ${new Date().toLocaleString("en-GB")}`;
}

// ─── Live Clock ────────────────────────────────────────────
function startClock() {
  const el = document.getElementById("headerClock");
  const tick = () => {
    el.textContent = new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
  };
  tick();
  setInterval(tick, 1000);
}

// ─── Firebase Realtime Listener ────────────────────────────
function setupRealtimeListeners() {
  const statusChip  = document.getElementById("connectionStatus");
  const statusText  = document.getElementById("statusText");
  const demoBadge   = document.getElementById("demoBadge");

  // Listen to all manholes data
  onValue(
    ref(db, "manholes"),
    snapshot => {
      // Connection is live
      statusChip.classList.add("connected");
      statusChip.classList.remove("error");
      statusText.textContent = "Connected";

      if (!snapshot.exists()) return;
      const data = snapshot.val();
      const mh1  = data.manhole1 || {};
      const mh2  = data.manhole2 || {};

      const hour  = new Date().getHours();
      const T     = getThresholds(hour);
      const { alerts, s1, s2 } = generateAlerts(mh1, mh2);

      // Update metric cards
      updateMetricCard(
        "card-mh1-level", "mh1Level", "mh1LevelStatus",
        Number(mh1.level), s1.lvlStatus, 1
      );
      updateMetricCard(
        "card-mh2-level", "mh2Level", "mh2LevelStatus",
        Number(mh2.level), s2.lvlStatus, 1
      );
      updateMetricCard(
        "card-mh1-flow", "mh1Flow", "mh1FlowStatus",
        Number(mh1.flow), s1.flwStatus, 1
      );
      updateMetricCard(
        "card-mh2-flow", "mh2Flow", "mh2FlowStatus",
        Number(mh2.flow), s2.flwStatus, 1
      );

      // Update manhole detail cards
      updateManholeCard("1", mh1, s1.lvlStatus, s1.flwStatus);
      updateManholeCard("2", mh2, s2.lvlStatus, s2.flwStatus);

      // Push to live charts
      pushChartPoint(
        Number(mh1.level), Number(mh2.level),
        Number(mh1.flow),  Number(mh2.flow)
      );

      // Render alerts
      renderAlerts(alerts);

      // Footer
      updateLastUpdated();
    },
    error => {
      statusChip.classList.remove("connected");
      statusChip.classList.add("error");
      statusText.textContent = "Connection Error";
      console.error("Firebase read error:", error);
    }
  );

  // Listen to system settings (demo mode)
  onValue(
    ref(db, "system"),
    snapshot => {
      if (!snapshot.exists()) return;
      const sys = snapshot.val();

      if (sys.demoMode === true && !isDemoActive) {
        isDemoActive = true;
        demoBadge.classList.remove("hidden");
        startDemoSimulation(db);
      } else if (sys.demoMode === false && isDemoActive) {
        isDemoActive = false;
        demoBadge.classList.add("hidden");
        stopDemoSimulation();
      }
    }
  );
}

// ─── Historical Data ───────────────────────────────────────
function initHistoricalDateDefaults() {
  const now = new Date();
  const end = now.toISOString().slice(0, 16);
  const start = new Date(now.getTime() - 6 * 60 * 60 * 1000)
    .toISOString().slice(0, 16);
  document.getElementById("endDate").value   = end;
  document.getElementById("startDate").value = start;
}

async function fetchHistory() {
  const btn       = document.getElementById("fetchHistoryBtn");
  const statusEl  = document.getElementById("historyStatus");
  const chartDiv  = document.getElementById("historyCharts");
  const exportBtn = document.getElementById("exportCsvBtn");

  const startVal = document.getElementById("startDate").value;
  const endVal   = document.getElementById("endDate").value;

  if (!startVal || !endVal) {
    statusEl.innerHTML =
      '<i class="ti ti-alert-circle"></i> Please select both start and end date/time.';
    return;
  }

  const startTs = new Date(startVal).getTime();
  const endTs   = new Date(endVal).getTime();

  if (endTs <= startTs) {
    statusEl.innerHTML =
      '<i class="ti ti-alert-circle"></i> End date must be after start date.';
    return;
  }

  btn.disabled  = true;
  statusEl.innerHTML = '<i class="ti ti-loader"></i> Fetching records...';

  try {
    const q = query(
      ref(db, "history/logs"),
      orderByChild("timestamp"),
      startAt(startTs),
      endAt(endTs),
      limitToLast(500)
    );

    const snapshot = await get(q);

    if (!snapshot.exists()) {
      statusEl.innerHTML =
        '<i class="ti ti-database-off"></i> No records found in the selected range.';
      chartDiv.classList.add("hidden");
      exportBtn.disabled = true;
      historyBuffer = [];
      btn.disabled = false;
      return;
    }

    // Convert to array sorted by timestamp
    historyBuffer = Object.values(snapshot.val())
      .sort((a, b) => a.timestamp - b.timestamp);

    renderHistoryCharts(historyBuffer);

    statusEl.innerHTML =
      `<i class="ti ti-circle-check"></i> Loaded <strong>${historyBuffer.length}</strong> records ` +
      `from ${new Date(startTs).toLocaleString("en-GB")} to ${new Date(endTs).toLocaleString("en-GB")}.`;

    chartDiv.classList.remove("hidden");
    exportBtn.disabled = false;

  } catch (err) {
    statusEl.innerHTML =
      `<i class="ti ti-alert-circle"></i> Error fetching data: ${err.message}`;
    console.error("History fetch error:", err);
  } finally {
    btn.disabled = false;
  }
}

function renderHistoryCharts(records) {
  const labels    = records.map(r =>
    new Date(r.timestamp).toLocaleString("en-GB", {
      month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit"
    })
  );
  const mh1Levels = records.map(r => r.mh1Level ?? null);
  const mh2Levels = records.map(r => r.mh2Level ?? null);
  const mh1Flows  = records.map(r => r.mh1Flow  ?? null);
  const mh2Flows  = records.map(r => r.mh2Flow  ?? null);

  const histOpts = (yMax, suffix) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#0f172a",
        titleColor: "#94a3b8",
        bodyColor: "#f1f5f9",
        padding: 10
      }
    },
    scales: {
      x: {
        grid: { color: "#f1f5f9" },
        ticks: {
          color: "#94a3b8", font: { size: 10 },
          maxTicksLimit: 12, maxRotation: 30
        }
      },
      y: {
        min: 0, max: yMax,
        grid: { color: "#f1f5f9" },
        ticks: {
          color: "#94a3b8", font: { size: 10 },
          callback: v => `${v}${suffix}`
        }
      }
    }
  });

  function makeDS(label, color, fill) {
    return {
      label, data: [],
      borderColor: color,
      backgroundColor: fill,
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.3,
      fill: true
    };
  }

  // Destroy old instances
  if (histLevelChart) histLevelChart.destroy();
  if (histFlowChart)  histFlowChart.destroy();

  histLevelChart = new Chart(
    document.getElementById("histLevelChart"),
    {
      type: "line",
      data: {
        labels,
        datasets: [
          { ...makeDS("MH1", CHART_TEAL,   CHART_TEAL_FILL),   data: mh1Levels },
          { ...makeDS("MH2", CHART_ORANGE, CHART_ORANGE_FILL), data: mh2Levels }
        ]
      },
      options: histOpts(100, "%")
    }
  );

  histFlowChart = new Chart(
    document.getElementById("histFlowChart"),
    {
      type: "line",
      data: {
        labels,
        datasets: [
          { ...makeDS("MH1", CHART_TEAL,   CHART_TEAL_FILL),   data: mh1Flows },
          { ...makeDS("MH2", CHART_ORANGE, CHART_ORANGE_FILL), data: mh2Flows }
        ]
      },
      options: histOpts(200, "L")
    }
  );
}

// ─── CSV Export ────────────────────────────────────────────
function exportCsv() {
  if (!historyBuffer.length) return;

  const rows = [
    ["Timestamp", "MH1 Level (%)", "MH2 Level (%)", "MH1 Flow (L/min)", "MH2 Flow (L/min)"],
    ...historyBuffer.map(r => [
      new Date(r.timestamp).toISOString(),
      r.mh1Level ?? "",
      r.mh2Level ?? "",
      r.mh1Flow  ?? "",
      r.mh2Flow  ?? ""
    ])
  ];

  const csv  = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `sewer-monitor-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Boot ─────────────────────────────────────────────────
function init() {
  startClock();
  initCharts();
  initHistoricalDateDefaults();
  setupRealtimeListeners();

  document.getElementById("fetchHistoryBtn")
    .addEventListener("click", fetchHistory);
  document.getElementById("exportCsvBtn")
    .addEventListener("click", exportCsv);
}

// Wait for Chart.js to load
if (typeof Chart !== "undefined") {
  init();
} else {
  document.addEventListener("DOMContentLoaded", init);

}
