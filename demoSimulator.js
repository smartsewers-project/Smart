// functions/demoSimulator.js
// ============================================================
// Demo Mode Simulation Engine
// Simulates realistic sewer monitoring data for two manholes
// Cycles through: Normal -> Rising -> Warning -> Critical -> Recovery
// Manhole 2 is offset by ~12 seconds to simulate flow propagation
// ============================================================

import { ref, set, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

let simulatorInterval = null;
let phase       = "normal";
let phaseStep   = 0;
let db_instance = null;

// Phase durations (in 5-second ticks)
const PHASE_TICKS = {
  normal:   12,   // 60s of normal
  rising:   8,    // 40s rising
  warning:  6,    // 30s at warning
  critical: 5,    // 25s at critical
  recovery: 10    // 50s recovery
};

const PHASE_ORDER = ["normal", "rising", "warning", "critical", "recovery"];

// Target value ranges per phase [min, max]
const PHASE_VALUES = {
  normal:   { level: [18, 38],  flow: [22, 55]  },
  rising:   { level: [40, 62],  flow: [60, 85]  },
  warning:  { level: [63, 74],  flow: [87, 118] },
  critical: { level: [78, 95],  flow: [128, 162]},
  recovery: { level: [62, 20],  flow: [115, 25] }  // descending
};

// MH2 is 60m downstream — slight lag and variation
const MH2_OFFSET = { level: -2, flow: 3 };

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

function interpolate(a, b, t) {
  return a + (b - a) * t;
}

function noise(val, magnitude = 2) {
  return val + (Math.random() - 0.5) * magnitude;
}

function getCurrentValues() {
  const range  = PHASE_VALUES[phase];
  const tTotal = PHASE_TICKS[phase];
  const t      = phaseStep / tTotal;

  let mh1Level, mh1Flow;

  if (phase === "recovery") {
    // Linearly descend from max warning back to normal
    mh1Level = interpolate(range.level[0], range.level[1], t);
    mh1Flow  = interpolate(range.flow[0],  range.flow[1],  t);
  } else if (phase === "rising") {
    mh1Level = interpolate(range.level[0], range.level[1], t);
    mh1Flow  = interpolate(range.flow[0],  range.flow[1],  t);
  } else {
    mh1Level = randomInRange(range.level[0], range.level[1]);
    mh1Flow  = randomInRange(range.flow[0],  range.flow[1]);
  }

  // Add realistic noise
  mh1Level = Math.max(0, Math.min(100, noise(mh1Level, 1.5)));
  mh1Flow  = Math.max(0, noise(mh1Flow, 2.5));

  // Manhole 2: slightly offset (60m downstream effect)
  // In recovery, MH2 recovers slightly slower
  let mh2Level = noise(
    mh1Level + MH2_OFFSET.level + (phase === "critical" ? 3 : 0),
    1.8
  );
  let mh2Flow = noise(
    mh1Flow + MH2_OFFSET.flow + (phase === "critical" ? 5 : 0),
    3.0
  );

  mh2Level = Math.max(0, Math.min(100, mh2Level));
  mh2Flow  = Math.max(0, mh2Flow);

  return {
    mh1Level: parseFloat(mh1Level.toFixed(2)),
    mh1Flow:  parseFloat(mh1Flow.toFixed(2)),
    mh2Level: parseFloat(mh2Level.toFixed(2)),
    mh2Flow:  parseFloat(mh2Flow.toFixed(2))
  };
}

function advancePhase() {
  phaseStep++;
  if (phaseStep >= PHASE_TICKS[phase]) {
    phaseStep = 0;
    const idx  = PHASE_ORDER.indexOf(phase);
    phase      = PHASE_ORDER[(idx + 1) % PHASE_ORDER.length];
  }
}

async function runSimulationTick() {
  if (!db_instance) return;

  const vals = getCurrentValues();
  const now  = Date.now();
  const ts   = new Date(now).toISOString();

  try {
    // Write current values to manholes
    await set(ref(db_instance, "manholes/manhole1/level"),     vals.mh1Level);
    await set(ref(db_instance, "manholes/manhole1/flow"),      vals.mh1Flow);
    await set(ref(db_instance, "manholes/manhole1/timestamp"), ts);

    await set(ref(db_instance, "manholes/manhole2/level"),     vals.mh2Level);
    await set(ref(db_instance, "manholes/manhole2/flow"),      vals.mh2Flow);
    await set(ref(db_instance, "manholes/manhole2/timestamp"), ts);

    // Write to history log
    await push(ref(db_instance, "history/logs"), {
      timestamp: now,
      mh1Level:  vals.mh1Level,
      mh1Flow:   vals.mh1Flow,
      mh2Level:  vals.mh2Level,
      mh2Flow:   vals.mh2Flow
    });

  } catch (err) {
    console.error("Demo simulator write error:", err);
  }

  advancePhase();
}

// ─── Public API ────────────────────────────────────────────

export function startDemoSimulation(db) {
  if (simulatorInterval) return; // Already running
  db_instance = db;
  phase       = "normal";
  phaseStep   = 0;

  console.info("[DemoSimulator] Started — phase:", phase);
  runSimulationTick(); // Immediate first tick
  simulatorInterval = setInterval(runSimulationTick, 5000);
}

export function stopDemoSimulation() {
  if (simulatorInterval) {
    clearInterval(simulatorInterval);
    simulatorInterval = null;
    db_instance       = null;
    console.info("[DemoSimulator] Stopped.");
  }
}

export function getDemoPhase() {
  return phase;
}