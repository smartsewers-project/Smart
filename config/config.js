// config/config.js
// ============================================================
// SENSITIVE CONFIGURATION — DO NOT COMMIT TO PUBLIC REPOSITORY
// Replace all placeholder values with your actual Firebase
// project credentials from Firebase Console >
// Project Settings > General > Your Apps > Web App
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyCjM7xFztcdP534zRGn-V-HqSTYHuaUQEo",
  authDomain: "sewer-monitor-app.firebaseapp.com",
  databaseURL: "https://sewer-monitor-app-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "sewer-monitor-app",
  storageBucket: "sewer-monitor-app.firebasestorage.app",
  messagingSenderId: "872870284052",
  appId: "1:872870284052:web:46c5580bd5db0359e11001"
};

// Database secret for ESP32 hardware authentication
// Found at: Firebase Console > Project Settings >
// Service Accounts > Database Secrets
// This value is for your ESP32 firmware only — not for the browser
export const databaseSecret = "HSwcDZThVvvYTs6Yow7iwqNBVIgJ1pyRrHvHBKMd";
