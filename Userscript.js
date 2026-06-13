// ==UserScript==
// @name         GeoFS Live Sink Rate
// @namespace    geofs-live-sink-rate
// @version      1.0
// @description  Shows current sink rate and vertical speed in GeoFS
// @match        https://www.geo-fs.com/*
// @match        https://geo-fs.com/*
// @match        https://beta.geo-fs.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    sampleMs: 150,
    smoothing: 0.22,
    panelTop: '90px',
    panelLeft: '16px'
  };

  const DIRECT_VS_PATHS = [
    ['animation', 'values', 'verticalSpeed'],
    ['animation', 'values', 'verticalspeed'],
    ['animation', 'values', 'climbRate'],
    ['animation', 'values', 'climbrate'],
    ['aircraft', 'instance', 'verticalSpeed'],
    ['aircraft', 'instance', 'climbRate'],
    ['aircraft', 'instance', 'animationValue', 'verticalSpeed'],
    ['aircraft', 'instance', 'animationValue', 'climbRate']
  ];

  const ALTITUDE_PATHS = [
    ['animation', 'values', 'altitude'],
    ['aircraft', 'instance', 'altitude'],
    ['aircraft', 'instance', 'llaLocation', 2],
    ['aircraft', 'instance', 'location', 2]
  ];

  let panel, sinkValueEl, vsValueEl, statusEl;
  let smoothedFpm = null;
  let lastAltM = null;
  let lastTime = null;

  function getByPath(root, path) {
    return path.reduce((acc, key) => (acc == null ? undefined : acc[key]), root);
  }

  function firstFinite(paths) {
    for (const path of paths) {
      const value = getByPath(window.geofs, path);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }

  function directVsToFpm(value) {
    const abs = Math.abs(value);
    if (abs < 120) return value * 196.850394; // assume m/s
    return value; // assume already ft/min
  }

  function readDirectVsFpm() {
    const raw = firstFinite(DIRECT_VS_PATHS);
    if (!Number.isFinite(raw)) return null;
    return directVsToFpm(raw);
  }

  function readAltitudeMeters() {
    const raw = firstFinite(ALTITUDE_PATHS);
    if (!Number.isFinite(raw)) return null;
    return raw; // most likely meters for GeoFS internal altitude-like values
  }

  function readDerivedVsFpm() {
    const altM = readAltitudeMeters();
    const now = performance.now();

    if (!Number.isFinite(altM)) {
      lastAltM = null;
      lastTime = null;
      return null;
    }

    if (lastAltM == null || lastTime == null) {
      lastAltM = altM;
      lastTime = now;
      return null;
    }

    const dt = (now - lastTime) / 1000;
    if (dt <= 0.05) return null;

    const dAltM = altM - lastAltM;
    lastAltM = altM;
    lastTime = now;

    const mps = dAltM / dt;
    return mps * 196.850394;
  }

  function fmt(n) {
    const rounded = Math.round(n);
    return rounded.toLocaleString('en-US');
  }

  function setColor(sinkFpm) {
    if (sinkFpm >= 2500) {
      panel.style.borderColor = '#ff4d4f';
      statusEl.textContent = 'HIGH SINK';
      statusEl.style.color = '#ff6b6b';
    } else if (sinkFpm >= 1200) {
      panel.style.borderColor = '#ffb020';
      statusEl.textContent = 'DESCENT';
      statusEl.style.color = '#ffd166';
    } else if (sinkFpm >= 50) {
      panel.style.borderColor = '#34c759';
      statusEl.textContent = 'STABLE';
      statusEl.style.color = '#7ee787';
    } else {
      panel.style.borderColor = '#58a6ff';
      statusEl.textContent = 'LEVEL / CLIMB';
      statusEl.style.color = '#8ab4ff';
    }
  }

  function updatePanel() {
    let rawFpm = readDirectVsFpm();
    if (!Number.isFinite(rawFpm)) {
      rawFpm = readDerivedVsFpm();
    }

    if (!Number.isFinite(rawFpm)) {
      sinkValueEl.textContent = '--';
      vsValueEl.textContent = '--';
      statusEl.textContent = 'WAITING';
      statusEl.style.color = '#c9d1d9';
      return;
    }

    smoothedFpm =
      smoothedFpm == null
        ? rawFpm
        : smoothedFpm + (rawFpm - smoothedFpm) * CONFIG.smoothing;

    const sinkFpm = Math.max(0, -smoothedFpm);

    sinkValueEl.textContent = `${fmt(sinkFpm)} ft/min`;
    vsValueEl.textContent = `${smoothedFpm >= 0 ? '+' : ''}${fmt(smoothedFpm)} ft/min`;

    setColor(sinkFpm);
  }

  function createPanel() {
    panel = document.createElement('div');
    panel.innerHTML = `
      <div style="font-size:12px; letter-spacing:0.08em; color:#8b949e; margin-bottom:6px;">GEOFS SINK RATE</div>
      <div style="font-size:24px; font-weight:700; line-height:1.1; margin-bottom:8px;" id="geofs-sink-value">--</div>
      <div style="font-size:13px; color:#c9d1d9; margin-bottom:6px;">
        VS: <span id="geofs-vs-value">--</span>
      </div>
      <div style="font-size:12px; font-weight:600;" id="geofs-sink-status">WAITING</div>
      <div style="font-size:11px; color:#8b949e; margin-top:8px;">Shift+S to hide/show</div>
    `;

    panel.style.cssText = `
      position: fixed;
      top: ${CONFIG.panelTop};
      left: ${CONFIG.panelLeft};
      z-index: 999999;
      min-width: 190px;
      padding: 12px 14px;
      background: rgba(11, 18, 32, 0.88);
      color: #ffffff;
      border: 2px solid #58a6ff;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.35);
      font-family: Inter, Arial, sans-serif;
      pointer-events: none;
      user-select: none;
      backdrop-filter: blur(6px);
    `;

    document.body.appendChild(panel);

    sinkValueEl = document.getElementById('geofs-sink-value');
    vsValueEl = document.getElementById('geofs-vs-value');
    statusEl = document.getElementById('geofs-sink-status');

    let visible = true;
    window.addEventListener('keydown', (e) => {
      if (e.shiftKey && e.code === 'KeyS') {
        visible = !visible;
        panel.style.display = visible ? 'block' : 'none';
      }
    });
  }

  function boot() {
    const timer = setInterval(() => {
      if (window.geofs && window.geofs.aircraft && window.geofs.aircraft.instance) {
        clearInterval(timer);
        createPanel();
        setInterval(updatePanel, CONFIG.sampleMs);
      }
    }, 500);
  }

  boot();
})();
