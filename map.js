// map.js
// ============================================================
// Leaflet + OpenStreetMap manhole location viewer
// Reads coordinates from Firebase — NOT hardcoded
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { firebaseConfig } from "./config/config.js";

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// Parse manhole ID from URL: manhole.html?id=1
const params    = new URLSearchParams(window.location.search);
const manholeId = params.get("id") === "2" ? "2" : "1";
const dbKey     = `manhole${manholeId}`;

// UI references
const pageTitle     = document.getElementById("mapPageTitle");
const sidebarBadge  = document.getElementById("sidebarBadge");
const sidebarTitle  = document.getElementById("sidebarTitle");
const sidebarSub    = document.getElementById("sidebarSubtitle");
const addrEl        = document.getElementById("sidebarAddress");
const coordsEl      = document.getElementById("sidebarCoords");
const levelEl       = document.getElementById("sidebarLevel");
const flowEl        = document.getElementById("sidebarFlow");
const tsEl          = document.getElementById("sidebarTimestamp");
const osmBtn        = document.getElementById("osmDirectionsBtn");
const googleBtn     = document.getElementById("googleDirectionsBtn");
const loadingEl     = document.getElementById("mapLoading");

let leafletMap  = null;
let marker      = null;

// ─── Initialise Map ────────────────────────────────────────
function initMap(lat, lng) {
  if (leafletMap) return; // already initialised

  loadingEl.style.display = "none";

  leafletMap = L.map("manholeMap", {
    center: [lat, lng],
    zoom:   16,
    zoomControl: true,
    scrollWheelZoom: true
  });

  // OpenStreetMap tile layer (completely free)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" ' +
      'target="_blank">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(leafletMap);

  // Custom teal marker
  const markerIcon = L.divIcon({
    className: "",
    html: `
      <div style="
        width:36px;height:36px;
        background:#0d9488;
        border:3px solid #fff;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        box-shadow:0 2px 8px rgba(0,0,0,0.3);
      "></div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -36]
  });

  marker = L.marker([lat, lng], { icon: markerIcon })
    .addTo(leafletMap)
    .bindPopup(
      `<strong>Manhole ${manholeId}</strong><br/>` +
      `${lat.toFixed(6)}, ${lng.toFixed(6)}`
    )
    .openPopup();
}

// ─── Update Directions Links ───────────────────────────────
function updateDirectionLinks(lat, lng, address) {
  // OpenStreetMap directions
  osmBtn.href =
    `https://www.openstreetmap.org/directions?to=${lat}%2C${lng}` +
    `#map=17/${lat}/${lng}`;

  // Google Maps fallback
  googleBtn.href =
    `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

// ─── Firebase Listener ────────────────────────────────────
function startListener() {
  pageTitle.textContent  = `Manhole ${manholeId} Location`;
  sidebarBadge.textContent = manholeId;
  sidebarTitle.textContent = `Manhole ${manholeId}`;
  sidebarSub.textContent   = manholeId === "1"
    ? "Upstream Reference Point"
    : "60m Downstream";

  onValue(
    ref(db, `manholes/${dbKey}`),
    snapshot => {
      if (!snapshot.exists()) {
        addrEl.textContent = "No location data in database yet.";
        return;
      }

      const data = snapshot.val();
      const lat  = Number(data.coordinates?.lat) || 0;
      const lng  = Number(data.coordinates?.lng) || 0;
      const addr = data.address || "Address not configured";

      addrEl.textContent   = addr;
      coordsEl.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      levelEl.textContent  = `${Number(data.level || 0).toFixed(1)} %`;
      flowEl.textContent   = `${Number(data.flow  || 0).toFixed(1)} L/min`;

      if (data.timestamp) {
        const d = new Date(data.timestamp);
        tsEl.textContent = isNaN(d.getTime())
          ? data.timestamp
          : d.toLocaleString("en-GB");
      }

      if (lat !== 0 || lng !== 0) {
        initMap(lat, lng);

        // Update marker position if map already exists
        if (marker) {
          marker.setLatLng([lat, lng]);
          marker.setPopupContent(
            `<strong>Manhole ${manholeId}</strong><br/>${addr}<br/>` +
            `${lat.toFixed(6)}, ${lng.toFixed(6)}`
          );
          leafletMap.setView([lat, lng], 16);
        }

        updateDirectionLinks(lat, lng, addr);
      } else {
        loadingEl.querySelector("span").textContent =
          "Coordinates not yet configured in database.";
      }
    },
    err => {
      console.error("Map Firebase error:", err);
      addrEl.textContent = "Error loading location data.";
    }
  );
}

// Boot when Leaflet is ready
function boot() {
  if (typeof L !== "undefined") {
    startListener();
  } else {
    const leafletScript = document.createElement("script");
    leafletScript.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    leafletScript.onload = startListener;
    document.head.appendChild(leafletScript);
  }
}

document.addEventListener("DOMContentLoaded", boot);