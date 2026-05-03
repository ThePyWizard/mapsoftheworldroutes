/* ============================================================
   mapsoftheworldroutes — Cesium 3D globe + route browser
   ------------------------------------------------------------
   Token, deep-link URLs, and the terrain toggle live in
   config.js — edit that, not this file.
   ============================================================ */

const cfg = window.APP_CONFIG || {};

/* ============================================================
   State
   ============================================================ */

const state = {
  routes: [],
  filtered: [],
  selectedId: null,
  viewer: null,
  routeEntities: [],   // entities for the currently displayed route
  originDots: null,    // initial-state hint dots
  autoRotate: true,    // idle camera spin; stopped on any user interaction or route selection
};

/* ============================================================
   Boot
   ============================================================ */

document.addEventListener('DOMContentLoaded', boot);

async function boot() {
  document.getElementById('year').textContent = new Date().getFullYear();
  document.getElementById('appBtn').href = cfg.APP_STORE_URL || '#';

  if (!cfg.CESIUM_ION_TOKEN) {
    showFatal(`No Cesium Ion token configured. Open <code>config.js</code> and paste your token from <a href="https://ion.cesium.com" target="_blank" rel="noopener" style="color:var(--accent);">ion.cesium.com</a>.`);
    return;
  }
  Cesium.Ion.defaultAccessToken = cfg.CESIUM_ION_TOKEN;

  try {
    const res = await fetch('routes.json');
    if (!res.ok) throw new Error(`routes.json failed: ${res.status}`);
    state.routes = await res.json();
  } catch (err) {
    console.error(err);
    showFatal('Could not load routes.json. If you opened this file directly, run a local server: <code>npx serve</code>');
    return;
  }

  state.routes = state.routes.map(resolveRoute).filter(Boolean);
  state.filtered = state.routes.slice();

  buildHeroStats();
  await buildGlobe();
  drawOriginDots();
  buildList();
  wireSearch();
  wireTabs();

  setTimeout(() => document.getElementById('loader').classList.add('hidden'), 800);
}

function showFatal(html) {
  const loader = document.getElementById('loader');
  loader.innerHTML = `<div class="loader-inner" style="padding: 24px; max-width: 480px;">
    <div style="font-size: 14px; color: var(--text); margin-bottom: 8px;">Something went wrong</div>
    <div style="font-size: 13px; color: var(--text-dim); line-height: 1.55;">${html}</div>
  </div>`;
}

/* ============================================================
   Geocode resolution
   ============================================================ */

function lookup(name) {
  const c = window.GEOCODE[name];
  if (!c) console.warn('Missing geocode for:', name);
  return c || null;
}

function resolveRoute(r) {
  const origin = lookup(r.origin);
  const dest   = lookup(r.destination);
  if (!origin || !dest) return null;

  const points = [
    { name: r.origin, ...origin, kind: 'origin' },
    ...((r.waypoints || []).map(w => {
      const c = lookup(w);
      return c ? { name: w, ...c, kind: 'waypoint' } : null;
    }).filter(Boolean)),
    { name: r.destination, ...dest, kind: 'destination' },
  ];

  return { ...r, points };
}

/* ============================================================
   Hero stats
   ============================================================ */

function buildHeroStats() {
  const countries = new Set();
  let totalKm = 0;
  for (const r of state.routes) {
    totalKm += (r.totalDistance || 0);
    for (const p of r.points) countries.add(p.name.split(',').pop().trim());
  }
  document.getElementById('routeCount').textContent    = state.routes.length;
  document.getElementById('countryCount').textContent  = countries.size;
  document.getElementById('totalDistance').textContent = totalKm.toLocaleString();
}

/* ============================================================
   Cesium globe
   ============================================================ */

async function buildGlobe() {
  const viewer = new Cesium.Viewer('globe', {
    // Hide all default chrome
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    creditContainer: 'cesiumCredits',
    // Render every frame. The traveling-dot animation needs a steady
    // clock, and on a single-globe scene the perf difference vs
    // requestRenderMode is negligible.
    requestRenderMode: false,
    // Honor the device's full pixel density. Without this Cesium
    // renders at 1× and the browser upscales — looks blurry on retina
    // / high-DPR displays (most phones, modern laptops).
    useBrowserRecommendedResolution: false,
    contextOptions: { webgl: { alpha: false, antialias: true } },
  });
  viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2);

  // Sharper imagery LOD — Cesium fetches a higher-detail tile sooner.
  // (Default is 2; lower = crisper but more bandwidth.)
  viewer.scene.globe.maximumScreenSpaceError = 1.5;

  // Imagery: Cesium World Imagery (Bing Maps Aerial via Ion asset 2)
  const imageryProvider = await Cesium.IonImageryProvider.fromAssetId(2);
  viewer.imageryLayers.removeAll();
  viewer.imageryLayers.addImageryProvider(imageryProvider);

  // Optional terrain
  if (cfg.USE_TERRAIN) {
    try {
      viewer.terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(1);
    } catch (e) {
      console.warn('Terrain unavailable, continuing with smooth globe:', e);
    }
  }

  // Visual polish
  const scene = viewer.scene;
  scene.globe.enableLighting = false;          // routes are easier to read with even illumination
  scene.globe.showGroundAtmosphere = true;
  scene.skyAtmosphere.show = true;
  scene.skyAtmosphere.hueShift  = -0.05;
  scene.skyAtmosphere.saturationShift = 0.1;
  scene.skyAtmosphere.brightnessShift = 0.05;
  scene.fog.enabled = true;
  scene.fog.density = 0.00015;
  scene.backgroundColor = Cesium.Color.fromCssColorString('#05060a');
  scene.globe.baseColor = Cesium.Color.fromCssColorString('#0a0d14');

  // Initial camera — frame the populated half of the globe
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-30, 25, 25_000_000),
  });

  // Auto-rotate the globe until the user interacts (canvas drag, scroll,
  // or selecting a route from the sidebar).
  const stopRotate = () => { state.autoRotate = false; };
  viewer.scene.canvas.addEventListener('pointerdown', stopRotate, { passive: true });
  viewer.scene.canvas.addEventListener('wheel',       stopRotate, { passive: true });
  viewer.scene.canvas.addEventListener('touchstart',  stopRotate, { passive: true });

  let lastTime = Date.now();
  viewer.clock.onTick.addEventListener(() => {
    const now = Date.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    if (!state.autoRotate) return;
    viewer.camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.04 * dt);
  });

  // Click handling: clicking on a city dot opens its route
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((click) => {
    const picked = viewer.scene.pick(click.position);
    if (picked && picked.id && picked.id.routeId != null) {
      selectRoute(picked.id.routeId, { fly: true });
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // Cursor on hover over interactive entities
  handler.setInputAction((m) => {
    const picked = viewer.scene.pick(m.endPosition);
    document.body.style.cursor =
      (picked && picked.id && picked.id.routeId != null) ? 'pointer' : '';
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  state.viewer = viewer;
}

/* ============================================================
   Marker images — glowing canvas-rendered pins
   ============================================================ */

const _pinCache = new Map();
function pinImage({ color, size = 64, coreRatio = 0.18, ringRatio = 0.24, halo = true }) {
  const key = `${color}|${size}|${coreRatio}|${ringRatio}|${halo ? 1 : 0}`;
  if (_pinCache.has(key)) return _pinCache.get(key);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2;

  if (halo) {
    // outer soft halo
    const grd = ctx.createRadialGradient(cx, cy, size * ringRatio, cx, cy, size * 0.5);
    grd.addColorStop(0, hexToRgba(color, 0.55));
    grd.addColorStop(0.55, hexToRgba(color, 0.18));
    grd.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
  }

  // white outline ring
  ctx.beginPath();
  ctx.arc(cx, cy, size * ringRatio, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = hexToRgba(color, 0.9);
  ctx.shadowBlur = halo ? 12 : 4;
  ctx.fill();
  ctx.shadowBlur = 0;

  // colored core
  ctx.beginPath();
  ctx.arc(cx, cy, size * coreRatio, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // inner highlight
  ctx.beginPath();
  ctx.arc(cx - size * 0.04, cy - size * 0.04, size * coreRatio * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();

  const url = canvas.toDataURL();
  _pinCache.set(key, url);
  return url;
}

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ============================================================
   Origin hint dots — visible before any route is selected
   ============================================================ */

function drawOriginDots() {
  const v = state.viewer;
  const seen = new Set();

  state.originDots = new Cesium.CustomDataSource('origin-hints');
  v.dataSources.add(state.originDots);

  const dotImage = pinImage({ color: '#22c96a', size: 48, coreRatio: 0.12, ringRatio: 0.16 });

  for (const r of state.routes) {
    const o = r.points[0];
    const key = `${o.lat.toFixed(2)},${o.lng.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    state.originDots.entities.add({
      position: Cesium.Cartesian3.fromDegrees(o.lng, o.lat),
      billboard: {
        image: dotImage,
        width: 22,
        height: 22,
        scaleByDistance: new Cesium.NearFarScalar(5e5, 1.4, 4e7, 0.55),
        // depth-tested by default — markers behind the globe are hidden
      },
      routeId: r.id,
    });
  }
}

function setOriginDotsVisible(show) {
  if (state.originDots) state.originDots.show = show;
}

/* ============================================================
   Plot the selected route
   ============================================================ */

function clearRoute() {
  const v = state.viewer;
  for (const e of state.routeEntities) v.entities.remove(e);
  state.routeEntities = [];
}

function plotRoute(r) {
  clearRoute();
  const v = state.viewer;

  // Build the polyline along origin → ...waypoints → destination
  const positions = r.points.flatMap(p => [p.lng, p.lat]);

  // Glowing polyline (geodesic — follows the curve of the earth)
  const line = v.entities.add({
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(positions),
      width: 6,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.25,
        taperPower: 1.0,
        color: Cesium.Color.fromCssColorString('#ff7a1a'),
      }),
      arcType: Cesium.ArcType.GEODESIC,
      clampToGround: false,
    },
    routeId: r.id,
  });
  state.routeEntities.push(line);

  // Markers at each point — canvas-rendered glowing pins (depth-tested,
  // so points on the far side of the globe are hidden naturally)
  for (const p of r.points) {
    const isEnd = p.kind !== 'waypoint';
    const color =
      p.kind === 'origin'      ? '#22c96a' :   // brand green = "go"
      p.kind === 'destination' ? '#ff2d6f' :   // hot pink = "arrive"
                                 '#4dd0e1';   // cyan = transitional waypoint

    const image = pinImage({
      color,
      size: isEnd ? 96 : 64,
      coreRatio: isEnd ? 0.16 : 0.13,
      ringRatio: isEnd ? 0.22 : 0.17,
      halo: true,
    });

    const e = v.entities.add({
      position: Cesium.Cartesian3.fromDegrees(p.lng, p.lat),
      billboard: {
        image,
        width: isEnd ? 44 : 28,
        height: isEnd ? 44 : 28,
        scaleByDistance: new Cesium.NearFarScalar(5e5, 1.3, 4e7, 0.5),
        translucencyByDistance: new Cesium.NearFarScalar(5e6, 1.0, 5e7, 0.7),
      },
      label: isEnd ? {
        text: shortLabel(p.name),
        font: '500 13px "Space Grotesk", sans-serif',
        fillColor: Cesium.Color.WHITE,
        style: Cesium.LabelStyle.FILL,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('rgba(10,13,20,0.92)'),
        backgroundPadding: new Cesium.Cartesian2(10, 6),
        pixelOffset: new Cesium.Cartesian2(0, -28),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        translucencyByDistance: new Cesium.NearFarScalar(1e6, 1.0, 2e7, 0.4),
      } : undefined,
      routeId: r.id,
    });
    state.routeEntities.push(e);
  }

  // Animated traveling dot
  const animated = makeTravelingDot(r);
  if (animated) state.routeEntities.push(animated);
}

function shortLabel(name) {
  // "Las Vegas, NV" → "Las Vegas"
  return name.split(',')[0];
}

/* A small dot that loops along the polyline — gives the route a sense of motion */
function makeTravelingDot(r) {
  const v = state.viewer;
  const segments = [];
  let totalLen = 0;
  for (let i = 0; i < r.points.length - 1; i++) {
    const a = r.points[i], b = r.points[i+1];
    const len = haversine(a, b);
    segments.push({ a, b, len });
    totalLen += len;
  }
  if (totalLen === 0) return null;

  // 12s for short routes, capped at 28s for very long ones
  const durationSec = Math.min(28, Math.max(8, totalLen / 200));
  const start = Cesium.JulianDate.now();
  const stop  = Cesium.JulianDate.addSeconds(start, durationSec, new Cesium.JulianDate());

  v.clock.startTime   = start.clone();
  v.clock.stopTime    = stop.clone();
  v.clock.currentTime = start.clone();
  v.clock.clockRange  = Cesium.ClockRange.LOOP_STOP;
  v.clock.multiplier  = 1;
  v.clock.shouldAnimate = true;

  const samples = new Cesium.SampledPositionProperty();
  samples.setInterpolationOptions({
    interpolationDegree: 1,
    interpolationAlgorithm: Cesium.LinearApproximation,
  });

  let elapsed = 0;
  for (const seg of segments) {
    const segDur = (seg.len / totalLen) * durationSec;
    const t0 = Cesium.JulianDate.addSeconds(start, elapsed, new Cesium.JulianDate());
    const t1 = Cesium.JulianDate.addSeconds(start, elapsed + segDur, new Cesium.JulianDate());
    samples.addSample(t0, Cesium.Cartesian3.fromDegrees(seg.a.lng, seg.a.lat));
    samples.addSample(t1, Cesium.Cartesian3.fromDegrees(seg.b.lng, seg.b.lat));
    elapsed += segDur;
  }

  const travelImg = pinImage({
    color: '#ff7a1a', size: 64, coreRatio: 0.20, ringRatio: 0.24, halo: true,
  });

  return v.entities.add({
    position: samples,
    billboard: {
      image: travelImg,
      width: 24,
      height: 24,
      scaleByDistance: new Cesium.NearFarScalar(5e5, 1.5, 4e7, 0.6),
    },
    routeId: r.id,
  });
}

function haversine(a, b) {
  const R = 6371;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat/2);
  const s2 = Math.sin(dLng/2);
  const v = s1*s1 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*s2*s2;
  return 2 * R * Math.asin(Math.sqrt(v));
}

/* ============================================================
   Camera flyTo
   ============================================================ */

function flyToRoute(r) {
  const v = state.viewer;
  if (!v || r.points.length === 0) return;

  // Build a bounding sphere from the route's points and let Cesium aim
  // the camera at its center. flyToBoundingSphere + HeadingPitchRange
  // is the API that respects a tilted viewing angle correctly — passing
  // a Rectangle + orientation puts the camera in a top-down position
  // and then tilts it, which aims at empty space ABOVE the route.
  const positions = r.points.map(p =>
    Cesium.Cartesian3.fromDegrees(p.lng, p.lat)
  );
  const sphere = Cesium.BoundingSphere.fromPoints(positions);

  // Range needs to be larger than the radius for a tilted view.
  // ~2.6× radius gives a comfortable cinematic frame; clamp to a sensible
  // minimum so super-short routes don't fly the camera too close.
  const range = Math.max(sphere.radius * 2.6, 200_000);

  v.camera.flyToBoundingSphere(sphere, {
    duration: 2.0,
    offset: new Cesium.HeadingPitchRange(
      0,                                   // heading: north
      Cesium.Math.toRadians(-55),          // pitch: looking down ~55°
      range,
    ),
  });
}

/* ============================================================
   Route list (right panel)
   ============================================================ */

function buildList() {
  const container = document.getElementById('routeList');
  if (state.filtered.length === 0) {
    container.innerHTML = `<div class="list-empty">No routes match your search.</div>`;
    return;
  }
  container.innerHTML = state.filtered.map(r => `
    <div class="list-item ${r.id === state.selectedId ? 'active' : ''}" data-id="${r.id}">
      <div class="list-item-num">${String(r.id).padStart(2, '0')}</div>
      <div class="list-item-body">
        <div class="list-item-title">${escapeHtml(r.title)}</div>
        <div class="list-item-route">${escapeHtml(r.origin)} → ${escapeHtml(r.destination)}</div>
        ${r.totalDistance ? `<div class="list-item-dist">${r.totalDistance.toLocaleString()} km</div>` : ''}
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.list-item').forEach(el => {
    el.addEventListener('click', () => {
      selectRoute(Number(el.dataset.id), { fly: true });
    });
  });
}

/* ============================================================
   Search
   ============================================================ */

function wireSearch() {
  const input = document.getElementById('searchInput');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    state.filtered = !q
      ? state.routes.slice()
      : state.routes.filter(r => {
          const hay = [r.title, r.origin, r.destination, (r.waypoints||[]).join(' '), r.whyTrending||'']
            .join(' ').toLowerCase();
          return hay.includes(q);
        });
    buildList();
  });
}

/* ============================================================
   Tabs
   ============================================================ */

function wireTabs() {
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      if (t.disabled) return;
      switchTab(t.dataset.tab);
    });
  });
  document.getElementById('backBtn').addEventListener('click', () => switchTab('list'));
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name)
  );
  document.getElementById('listView').classList.toggle('hidden', name !== 'list');
  document.getElementById('detailView').classList.toggle('hidden', name !== 'detail');
}

/* ============================================================
   Select route
   ============================================================ */

function selectRoute(id, { fly = false } = {}) {
  const r = state.routes.find(x => x.id === id);
  if (!r) return;

  state.selectedId = id;
  state.autoRotate = false;          // sidebar clicks never touch the canvas — stop the spin here too
  setOriginDotsVisible(false);
  plotRoute(r);
  if (fly) flyToRoute(r);

  renderDetail(r);
  document.getElementById('detailTab').disabled = false;
  switchTab('detail');

  // hint text update
  const hint = document.getElementById('hintText');
  if (hint) hint.textContent = `Showing route ${String(r.id).padStart(2,'0')} · ${r.origin} → ${r.destination}`;

  // highlight in list
  document.querySelectorAll('.list-item').forEach(el =>
    el.classList.toggle('active', Number(el.dataset.id) === id)
  );
}

/* ============================================================
   Detail panel render
   ============================================================ */

function renderDetail(r) {
  const wp = (r.waypoints || []);
  const dur = r.scriptDurationSeconds ? `${r.scriptDurationSeconds}s` : '—';
  const dist = r.totalDistance ? `${r.totalDistance.toLocaleString()} km` : '—';

  const html = `
    <div class="detail-num">ROUTE · ${String(r.id).padStart(2, '0')}</div>
    <h2 class="detail-title">${escapeHtml(r.title)}</h2>

    <div class="detail-route">
      <div class="detail-route-row">
        <div class="detail-route-label">From</div>
        <div class="detail-route-value">${escapeHtml(r.origin)}</div>
      </div>
      <div class="detail-route-row">
        <div class="detail-route-label">To</div>
        <div class="detail-route-value">${escapeHtml(r.destination)}</div>
      </div>
      ${wp.length ? `
        <div class="detail-route-row" style="align-items: flex-start;">
          <div class="detail-route-label">Via</div>
          <ul class="detail-waypoints" style="margin: 0; padding-left: 0;">
            ${wp.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>

    <div class="detail-stats">
      <div class="detail-stat">
        <div class="detail-stat-label">Distance</div>
        <div class="detail-stat-value">${dist}</div>
      </div>
      <div class="detail-stat">
        <div class="detail-stat-label">Voiceover</div>
        <div class="detail-stat-value">${dur}</div>
      </div>
    </div>

    ${r.script ? `
      <div class="detail-section-title">The script</div>
      <p class="detail-script">${escapeHtml(r.script)}</p>
    ` : ''}

    ${r.whyTrending ? `
      <div class="detail-section-title">Why it's trending</div>
      <div class="detail-trending">${escapeHtml(r.whyTrending)}</div>
    ` : ''}

    <div class="detail-actions">
      <a class="btn-primary" href="${buildDeepLink(r.id)}" data-route="${r.id}">
        Open in TravelAnimator →
      </a>
      ${r.googleMapsUrl ? `
        <a class="btn-secondary" href="${escapeHtml(r.googleMapsUrl)}" target="_blank" rel="noopener">
          View on Google Maps
        </a>
      ` : ''}
    </div>
  `;

  document.getElementById('detailContent').innerHTML = html;

  const btn = document.querySelector('.btn-primary[data-route]');
  if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); tryDeepLink(r.id); });
}

/* ============================================================
   Deep link
   ============================================================ */

function buildDeepLink(routeId)   { return `${cfg.DEEP_LINK_HTTPS}/${routeId}`; }
function buildSchemeLink(routeId) { return `${cfg.DEEP_LINK_SCHEME}?id=${routeId}`; }

function tryDeepLink(routeId) {
  const universal = buildDeepLink(routeId);
  const scheme    = buildSchemeLink(routeId);
  const start     = Date.now();

  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = scheme;
  document.body.appendChild(iframe);
  setTimeout(() => iframe.remove(), 500);

  window.location.href = universal;

  setTimeout(() => {
    if (Date.now() - start < 2200 && document.visibilityState === 'visible') {
      window.location.href = cfg.APP_STORE_URL;
    }
  }, 1800);
}

/* ============================================================
   Util
   ============================================================ */

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
