"use strict";
/* ============================================================
   Marine forecasts: a route (waypoints with arrival times, and positions in between) or a single point over
   a time range. Wind, gusts and weather blend the NWS forecast, the NBM and the global models; chances of
   strong wind come from the GEFS and ECMWF ensembles; seas, swell and wind waves blend the wave models
   (WAVEWATCH III, ECMWF WAM, MFWAM, GWAM), the NWS gridded waves and the NBM wave height. The forecaster
   can change any value; ranges and chances follow the edit. Routes, positions and edits stay on this
   computer (they never go to GitHub or the public page).
   ============================================================ */
const $ = id => document.getElementById(id);
const DEMO = /[?&]demo=1\b/.test(location.search) || !!window.FORCE_DEMO;
const LSK = "marinefx:v1";
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const store = { get(k, d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full */ } } };
const NM_KM = 1.852;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = v => v == null ? null : Math.round(v*10)/10;
const uid = () => Math.random().toString(36).slice(2, 9);
const ordinalN = n => { const t = n % 100; return n + (t >= 11 && t <= 13 ? "th" : ["th","st","nd","rd"][n % 10] || "th"); };

/* ---------- state (kept in this browser) ---------- */
const DEF = {
  mode:"route", title:"", fc:"", zulu:false,
  route:{ pts:[], depart:null, speed:10, auto:true, legH:3 },
  point:{ name:"", lat:null, lon:null, start:null, end:null, step:3 },
  thr:{ wind:[20, 25, 34], seas:[4, 6, 8] }, pct:[25, 75],
  src:{}, edits:{}, disc:null, remarks:"", zonesInProduct:true,
  view:{ lat:28.5, lon:-79.6, k:90 }, saved:{}
};
let M = Object.assign(structuredClone(DEF), store.get(LSK, {}));
M.route = Object.assign(structuredClone(DEF.route), M.route || {}); M.point = Object.assign(structuredClone(DEF.point), M.point || {});
M.thr = Object.assign(structuredClone(DEF.thr), M.thr || {}); M.view = Object.assign(structuredClone(DEF.view), M.view || {});
const save = () => store.set(LSK, M);

/* ---------- sources ---------- */
const MSRC = [
  { id:"nws",  name:"NWS forecast (NDFD)", kind:"nws",  w:2,   grp:"NWS",   note:"wind, weather and waves; US waters" },
  { id:"nbm",  name:"NBM",                 kind:"om",   w:1.5, grp:"Wind and weather", model:"ncep_nbm_conus" },
  { id:"gfs",  name:"GFS",                 kind:"om",   w:1,   grp:"Wind and weather", model:"gfs_seamless" },
  { id:"ifs",  name:"ECMWF IFS",           kind:"om",   w:1,   grp:"Wind and weather", model:"ecmwf_ifs025" },
  { id:"icon", name:"ICON",                kind:"om",   w:1,   grp:"Wind and weather", model:"icon_global" },
  { id:"gem",  name:"GEM",                 kind:"om",   w:1,   grp:"Wind and weather", model:"gem_global" },
  { id:"ukmo", name:"UKMO",                kind:"om",   w:1,   grp:"Wind and weather", model:"ukmo_global_deterministic_10km" },
  { id:"gefs", name:"GEFS ensemble",       kind:"ens",  w:1,   grp:"Ensembles (chance of strong wind)", model:"gfs025" },
  { id:"eps",  name:"ECMWF ensemble",      kind:"ens",  w:1,   grp:"Ensembles (chance of strong wind)", model:"ecmwf_ifs025" },
  { id:"ww3",  name:"WAVEWATCH III (GFS-Wave)", kind:"wave", w:1, grp:"Wave models", models:["ncep_gfswave016", "ncep_gfswave025"] },
  { id:"ecwam",name:"ECMWF WAM",           kind:"wave", w:1,   grp:"Wave models", models:["ecmwf_wam", "ecmwf_wam025"] },
  { id:"mfwam",name:"Météo-France MFWAM",  kind:"wave", w:1,   grp:"Wave models", models:["meteofrance_wave"] },
  { id:"gwam", name:"DWD GWAM",            kind:"wave", w:1,   grp:"Wave models", models:["gwam"] },
  { id:"nbmw", name:"NBM wave height (text)", kind:"nbmw", w:1, grp:"Wave models", note:"nearest NBM marine station" },
];
const srcOn = s => !M.src[s.id] || M.src[s.id].on !== false;
const srcW = s => M.src[s.id] && isFinite(+M.src[s.id].w) ? +M.src[s.id].w : s.w;

/* fields: atm = wind/weather sources, wave = wave sources; units kt, ft, s, degrees from, %, nm, F */
const ATM = ["ws", "wd", "wg", "pop", "tst", "vis", "t"];
const WAVEF = ["wvh", "wvp", "wvd", "wwh", "swh", "swp", "swd", "sst"];
const DIRK = new Set(["wd", "wvd", "swd"]);
const HTK = new Set(["wvh", "wwh", "swh"]);
const FLD = {
  wd:{ l:"Wind from", u:"" }, ws:{ l:"Wind", u:"kt" }, wg:{ l:"Gusts", u:"kt" },
  wvh:{ l:"Seas", u:"ft" }, wvp:{ l:"Period", u:"s" }, wvd:{ l:"Waves from", u:"" },
  swh:{ l:"Swell", u:"ft" }, swp:{ l:"Swell period", u:"s" }, swd:{ l:"Swell from", u:"" }, wwh:{ l:"Wind waves", u:"ft" },
  pop:{ l:"Rain", u:"%" }, tst:{ l:"Thunder", u:"%" }, vis:{ l:"Visibility", u:"nm" }, t:{ l:"Air", u:"°F" }, sst:{ l:"Water", u:"°F" }
};

/* ---------- time ---------- */
const TL = { t0:0, n:0, idx(ms){ return Math.round((ms - this.t0)/H); } };
function resetTL(){ TL.t0 = Math.floor(Date.now()/H)*H - 24*H; TL.n = 24*11; }
resetTL();
function fromLocalInput(s){
  if (!s) return null; const m = String(s).match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/); if (!m) return null;
  const want = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (M.zulu) return want;
  let g = want; for (let k = 0; k < 3; k++){ const p = lp(g); g += want - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi); }
  return g;
}
function toLocalInput(ms){
  if (ms == null || !isFinite(ms)) return "";
  if (M.zulu){ const d = new Date(ms); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; }
  const p = lp(ms); return `${p.y}-${pad2(p.mo)}-${pad2(p.d)}T${pad2(p.h)}:${pad2(p.mi)}`;
}
const tLabel = ms => { const z = M.zulu, L = dayLabel(ms, z); return `${L.wd.slice(0, 3)} ${L.dt.split(" ")[0]} ${hhmm(ms, z)}${z ? "Z" : "L"}`; };
const tLong = ms => { const z = M.zulu, L = dayLabel(ms, z); return `${L.wd} ${L.dt} ${hhmm(ms, z)}${z ? "Z" : " " + tzAbbr(ms)}`; };

/* ---------- geometry ---------- */
const nmBetween = (a, b) => kmBetween(a.lat, a.lon, b.lat, b.lon)/NM_KM;
function course(a, b){ const y = Math.sin((b.lon - a.lon)*Math.PI/180)*Math.cos(b.lat*Math.PI/180), x = Math.cos(a.lat*Math.PI/180)*Math.sin(b.lat*Math.PI/180) - Math.sin(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.cos((b.lon - a.lon)*Math.PI/180); return (Math.atan2(y, x)*180/Math.PI + 360) % 360; }
function parseCoord(t){
  t = String(t == null ? "" : t).trim().toUpperCase(); if (!t) return null;
  const neg = /[SW]\s*$/.test(t) || /^\s*[SW]/.test(t) || t.startsWith("-");
  const nums = t.replace(/[^0-9.\s]/g, " ").trim().split(/\s+/).map(Number).filter(isFinite);
  if (!nums.length) return null;
  const v = nums[0] + (nums[1] || 0)/60 + (nums[2] || 0)/3600;
  return neg ? -v : v;
}
const fmtLat = v => v == null ? "" : `${Math.abs(v).toFixed(3)}°${v < 0 ? "S" : "N"}`;
const fmtLon = v => v == null ? "" : `${Math.abs(v).toFixed(3)}°${v < 0 ? "W" : "E"}`;
const fmtPos = (la, lo) => `${fmtLat(la)} ${fmtLon(lo)}`;

/* ---------- the route: arrival times and forecast rows ---------- */
function routeTimes(){
  const R = M.route, pts = R.pts.filter(p => p.lat != null && p.lon != null);
  if (!R.auto) return pts.map(p => ({ ...p, t: p.t }));
  let t = R.depart, out = [];
  pts.forEach((p, i) => {
    if (i > 0 && t != null){ const sp = +R.speed > 0 ? +R.speed : 10; t += nmBetween(pts[i - 1], p)/sp*H; t += (+(pts[i - 1].stay || 0))*H; }
    out.push({ ...p, t: t == null ? null : Math.round(t/60e3)*60e3 });
  });
  return out;
}
let ROWS = [];
function buildRows(){
  const rows = [];
  if (M.mode === "point"){
    const P = M.point; if (P.lat == null || P.lon == null || !P.start || !P.end || P.end < P.start) return (ROWS = []);
    const step = (+P.step || 3)*H, a = Math.ceil(P.start/step)*step;
    for (let t = a, k = 0; t <= P.end && k < 240; t += step, k++) rows.push({ key:`p@${t}`, name: P.name || "Point", lat:P.lat, lon:P.lon, t, wp:true, n:"" });
    rows.forEach(r => r.li = locKey(r.lat, r.lon));
    return (ROWS = rows);
  }
  const pts = routeTimes(), legH = +M.route.legH || 0;
  pts.forEach((p, i) => {
    if (p.t == null) return;
    rows.push({ key:`${p.id}@${p.t}`, name: p.name || `Waypoint ${i + 1}`, lat:p.lat, lon:p.lon, t:p.t, wp:true, n:String(i + 1) });
    const q = pts[i + 1]; if (!legH || !q || q.t == null) return;
    const t0 = p.t + (+(p.stay || 0))*H;
    if (p.stay > 0) rows.push({ key:`${p.id}~dep@${t0}`, name:`Leave ${p.name || "waypoint " + (i + 1)}`, lat:p.lat, lon:p.lon, t:t0, wp:false, n:"" });
    for (let t = Math.ceil((t0 + 1)/(legH*H))*legH*H; t < q.t - 20*60e3; t += legH*H){
      const f = (t - t0)/(q.t - t0); if (f <= 0 || f >= 1) continue;
      rows.push({ key:`${p.id}>${q.id}@${t}`, name:"En route", lat: p.lat + (q.lat - p.lat)*f, lon: p.lon + (q.lon - p.lon)*f, t, wp:false, n:"" });
    }
  });
  ROWS = rows.slice(0, 240); ROWS.forEach(r => r.li = locKey(r.lat, r.lon));
  return ROWS;
}

/* ---------- guidance store: one entry per location (rounded to 0.05°) ---------- */
let G = { locs:[], byKey:{}, src:{}, ens:{}, status:{}, cwf:{}, nbmStn:{}, fetchedAt:null, loading:false };
const locKey = (la, lo) => `${(Math.round(la*20)/20).toFixed(2)},${(Math.round(lo*20)/20).toFixed(2)}`;
function locsFor(rows){
  const out = [], seen = {};
  for (const r of rows){ const k = locKey(r.lat, r.lon); if (!(k in seen)){ seen[k] = out.length; const [la, lo] = k.split(",").map(Number); out.push({ key:k, lat:la, lon:lo }); } r.li = k; }
  return out;
}
const arr = () => new Array(TL.n).fill(null);
const emptyRec = keys => { const o = {}; keys.forEach(k => o[k] = arr()); return o; };

/* Open-Meteo forecast models, every location in one call per model */
async function fetchOMModel(s, locs){
  const lat = locs.map(l => l.lat).join(","), lon = locs.map(l => l.lon).join(",");
  const base = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&models=${s.model}&wind_speed_unit=kn&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=GMT&timeformat=unixtime&forecast_days=10&past_days=1&hourly=`;
  let js; const full = "wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,precipitation_probability,weather_code,visibility,temperature_2m";
  try { js = await getJSON(base + full, 45000); }
  catch (e){ if (e.status !== 400) throw e; js = await getJSON(base + "wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,weather_code,temperature_2m", 45000); }
  const A = Array.isArray(js) ? js : [js];
  return locs.map((l, li) => {
    const hr = (A[li] || {}).hourly || {}, o = emptyRec(ATM), g = k => hr[k] || [];
    (hr.time || []).forEach((t, j) => {
      const i = TL.idx(t*1000); if (i < 0 || i >= TL.n) return;
      const v = k => g(k)[j] == null ? null : g(k)[j];
      o.ws[i] = v("wind_speed_10m"); o.wd[i] = v("wind_direction_10m"); o.wg[i] = v("wind_gusts_10m"); o.t[i] = v("temperature_2m");
      const vis = v("visibility"); o.vis[i] = vis == null ? null : Math.min(10, vis/1852);
      const wc = v("weather_code"); o.tst[i] = wc == null ? null : wc >= 95 ? 100 : 0;
      const pp = v("precipitation_probability"), pr = v("precipitation"); o.pop[i] = pp != null ? pp : pr == null ? null : pr >= 0.01 ? 100 : 0;
    });
    /* thunder and rain are "any time near this hour": spread one hour each side */
    for (const k of ["tst"]){ const a = o[k].slice(); for (let i = 0; i < TL.n; i++){ const m = Math.max(a[i - 1] ?? -1, a[i] ?? -1, a[i + 1] ?? -1); o[k][i] = m < 0 ? null : m; } }
    return o.ws.some(v => v != null) ? o : null;
  });
}
/* ensembles: wind speed members (kt) */
async function fetchEns(s, locs){
  const lat = locs.map(l => l.lat).join(","), lon = locs.map(l => l.lon).join(",");
  const js = await getJSON(`https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${lat}&longitude=${lon}&models=${s.model}&hourly=wind_speed_10m&wind_speed_unit=kn&timezone=GMT&timeformat=unixtime&forecast_days=10&past_days=1`, 60000);
  const A = Array.isArray(js) ? js : [js];
  return locs.map((l, li) => {
    const hr = (A[li] || {}).hourly || {}, mem = [];
    for (const k of Object.keys(hr)){
      if (!k.startsWith("wind_speed_10m")) continue;
      const a = arr(); (hr.time || []).forEach((t, j) => { const i = TL.idx(t*1000); if (i >= 0 && i < TL.n) a[i] = hr[k][j]; });
      if (a.some(v => v != null)) mem.push(a);
    }
    return mem.length ? mem : null;
  });
}
/* wave models (heights ft, periods s, directions from, water F) */
async function fetchWaves(s, locs){
  const lat = locs.map(l => l.lat).join(","), lon = locs.map(l => l.lon).join(",");
  const vars = "wave_height,wave_period,wave_direction,wind_wave_height,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature";
  let js = null, used = null, last = null;
  for (const model of s.models){
    try { js = await getJSON(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=${vars}&models=${model}&timezone=GMT&timeformat=unixtime&forecast_days=10&past_days=1`, 45000); used = model; break; }
    catch (e){ last = e; }
  }
  if (!js) throw last || new Error("not available");
  const A = Array.isArray(js) ? js : [js], ft = v => v == null ? null : v*M2FT;
  const res = locs.map((l, li) => {
    const hr = (A[li] || {}).hourly || {}, o = emptyRec(WAVEF);
    (hr.time || []).forEach((t, j) => {
      const i = TL.idx(t*1000); if (i < 0 || i >= TL.n) return;
      const g = k => hr[k] && hr[k][j] != null ? hr[k][j] : null;
      o.wvh[i] = ft(g("wave_height")); o.wwh[i] = ft(g("wind_wave_height")); o.swh[i] = ft(g("swell_wave_height"));
      o.wvp[i] = g("wave_period"); o.swp[i] = g("swell_wave_period"); o.wvd[i] = g("wave_direction"); o.swd[i] = g("swell_wave_direction");
      const sst = g("sea_surface_temperature"); o.sst[i] = sst == null ? null : sst*9/5 + 32;
    });
    fillWaveGaps(o, WAVEF, 3);
    return o.wvh.some(v => v != null) ? o : null;
  });
  res.model = used; return res;
}
/* the NWS gridded forecast at each location (US waters and coasts) */
const _grid = {};
async function fetchNWS(locs){
  const KMH = 0.539957, out = [];
  const conv = (prop, v) => { if (v == null) return null; const u = String(prop.uom || prop.unitCode || ""); if (/degC/.test(u)) return v*9/5 + 32; if (/km_h/.test(u)) return v*KMH; if (/m_s/.test(u)) return v*1.943844; return v; };
  const dur = s => { const m = String(s || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?/); return ((+m[1] || 0)*24 + (+m[2] || 0)) || 1; };
  for (const l of locs){
    try {
      let url = _grid[l.key];
      if (url === undefined){ try { const pt = await getJSON(`https://api.weather.gov/points/${l.lat.toFixed(4)},${l.lon.toFixed(4)}`, 15000); url = pt.properties && pt.properties.forecastGridData || null; } catch (e) { url = null; } _grid[l.key] = url; }
      if (!url){ out.push(null); continue; }
      const P = (await getJSON(url, 25000)).properties || {}, o = emptyRec([...ATM, ...WAVEF]);
      const fill = (name, k, f) => { const prop = P[name]; if (!prop || !prop.values) return;
        for (const it of prop.values){ const [st, d] = String(it.validTime).split("/"); const a = Date.parse(st), h = dur(d); let v = conv(prop, it.value); if (v == null || !isFinite(v)) continue; if (f) v = f(v);
          for (let q = 0; q < h; q++){ const i = TL.idx(a + q*H); if (i >= 0 && i < TL.n) o[k][i] = v; } } };
      fill("windSpeed", "ws"); fill("windGust", "wg"); fill("windDirection", "wd"); fill("temperature", "t");
      fill("probabilityOfPrecipitation", "pop"); fill("probabilityOfThunder", "tst"); fill("visibility", "vis", v => Math.min(10, v/1852));
      fill("waveHeight", "wvh", v => v*M2FT); fill("wavePeriod", "wvp"); fill("waveDirection", "wvd");
      fill("primarySwellHeight", "swh", v => v*M2FT); fill("primarySwellDirection", "swd"); fill("windWaveHeight", "wwh", v => v*M2FT);
      out.push(o);
    } catch (e) { out.push(null); }
  }
  return out;
}
/* the NBM wave height at the nearest marine station to each location */
async function fetchNBMW(locs){
  const st = {}, res = [];
  for (const l of locs){ const nb = nearestNBMMarine(l.lat, l.lon); l.nbm = nb ? nb.id : null; if (nb) st[nb.id] = st[nb.id] || null; }
  for (const id of Object.keys(st)){
    try { const g = await fetchNBMWaves([{ id:"x" }], TL, id); st[id] = g.x ? g.x.members[0] : null; } catch (e) { st[id] = null; }
  }
  for (const l of locs){ const m = l.nbm && st[l.nbm]; if (!m || !m.wvh){ res.push(null); continue; } const o = emptyRec(WAVEF); o.wvh = m.wvh.slice(0, TL.n); res.push(o); }
  G.nbmStn = st;
  return res;
}

/* ---------- loading ---------- */
let loadSeq = 0;
async function loadAll(){
  const seq = ++loadSeq; resetTL();
  buildRows();
  const locs = locsFor(ROWS).slice(0, 60);
  G = { locs, byKey:Object.fromEntries(locs.map((l, i) => [l.key, i])), src:{}, ens:{}, status:{}, cwf:{}, nbmStn:{}, fetchedAt:Date.now(), loading:true };
  if (!locs.length){ G.loading = false; renderAll(); return; }
  MSRC.forEach(s => G.status[s.id] = { loading:true });
  renderAll();
  const done = (s, res, note) => { if (seq !== loadSeq) return; if (res && res.some(Boolean)){ G.src[s.id] = res; G.status[s.id] = { ok:true, note: note || `${res.filter(Boolean).length} of ${locs.length} positions` }; } else G.status[s.id] = { err: s.kind === "nws" ? "outside NWS waters" : "no data here" }; scheduleRender(); };
  const fail = (s, e) => { if (seq !== loadSeq) return; G.status[s.id] = { err: e && e.status === 400 ? "not served for these positions" : "not available" }; scheduleRender(); };
  const tasks = MSRC.map(s => {
    if (DEMO) return demoSource(s, locs).then(r => s.kind === "ens" ? ensDone(s, r) : done(s, r));
    if (s.kind === "om") return fetchOMModel(s, locs).then(r => done(s, r)).catch(e => fail(s, e));
    if (s.kind === "ens") return fetchEns(s, locs).then(r => ensDone(s, r)).catch(e => fail(s, e));
    if (s.kind === "wave") return fetchWaves(s, locs).then(r => done(s, r, r.model)).catch(e => fail(s, e));
    if (s.kind === "nws") return fetchNWS(locs).then(r => done(s, r)).catch(e => fail(s, e));
    if (s.kind === "nbmw") return fetchNBMW(locs).then(r => done(s, r, Object.keys(G.nbmStn).filter(k => G.nbmStn[k]).map(k => "station " + k).join(", ") || null)).catch(e => fail(s, e));
    return Promise.resolve();
  });
  function ensDone(s, r){ if (seq !== loadSeq) return; if (r && r.some(Boolean)){ G.ens[s.id] = r; G.status[s.id] = { ok:true, note:`${(r.find(Boolean) || []).length} members` }; } else G.status[s.id] = { err:"no data here" }; scheduleRender(); }
  /* NWS marine text for the zones along the route (waypoints only) */
  const wps = ROWS.filter(r => r.wp), seenZ = {};
  tasks.push((async () => {
    for (const r of wps){
      const k = locKey(r.lat, r.lon); if (seenZ[k]) continue; seenZ[k] = 1;
      try { const c = DEMO ? demoCWF(r) : await fetchCWF(r.lat, r.lon); if (seq !== loadSeq) return; if (c){ G.cwf[c.id] = G.cwf[c.id] || { ...c, at:[] }; G.cwf[c.id].at.push(r.n || r.name); } } catch (e) { /* no zone */ }
    }
    if (seq === loadSeq) scheduleRender();
  })());
  await Promise.allSettled(tasks);
  if (seq !== loadSeq) return;
  G.loading = false; renderAll();
}
let _rt = 0; function scheduleRender(){ clearTimeout(_rt); _rt = setTimeout(renderAll, 120); }

/* ---------- the forecast at each row ---------- */
function wq(vals, wts, q){ const r = wquant(vals, wts, q); return r; }
function dirMean(pairs){ let U = 0, V = 0, W = 0; for (const [d, w] of pairs){ if (d == null) continue; U += Math.sin(d*Math.PI/180)*w; V += Math.cos(d*Math.PI/180)*w; W += w; } return W ? (Math.atan2(U, V)*180/Math.PI + 360) % 360 : null; }
const normCdf = z => { const t = 1/(1 + 0.2316419*Math.abs(z)), d = 0.3989423*Math.exp(-z*z/2), p = d*t*(0.3193815 + t*(-0.3565638 + t*(1.781478 + t*(-1.821256 + t*1.330274)))); return z > 0 ? 1 - p : p; };
function calcRow(r){
  const li = G.byKey[r.li], i = TL.idx(r.t), out = { g:{}, o:{}, rng:{}, p:{}, srcv:{}, n:{} };
  if (li == null || i < 0 || i >= TL.n) return out;
  const lead = Math.max(0, (r.t - Date.now())/(24*H));
  for (const k of [...ATM, ...WAVEF]){
    const wave = WAVEF.includes(k), pairs = [], vals = [], wts = [], sv = {};
    for (const s of MSRC){
      if (!srcOn(s) || s.kind === "ens") continue;
      if (wave ? !(s.kind === "wave" || s.kind === "nws" || s.kind === "nbmw") : !(s.kind === "om" || s.kind === "nws")) continue;
      const rec = G.src[s.id] && G.src[s.id][li]; if (!rec || !rec[k]) continue;
      const v = rec[k][i]; if (v == null) continue;
      const w = srcW(s); if (!(w > 0)) continue;
      pairs.push([v, w]); vals.push(v); wts.push(w); sv[s.id] = v;
    }
    out.srcv[k] = sv; out.n[k] = vals.length;
    out.g[k] = DIRK.has(k) ? dirMean(pairs) : wmean(pairs);
    if (HTK.has(k) || k === "ws") out.rng[k] = vals.length >= 3 ? wq(vals, wts, [M.pct[0]/100, M.pct[1]/100]) : vals.length === 2 ? [Math.min(...vals), Math.max(...vals)] : null;
  }
  /* edits */
  const ed = M.edits[r.key] || {};
  for (const k of Object.keys(out.g)) out.o[k] = ed[k] !== undefined ? ed[k] : out.g[k];
  out.ed = ed;
  /* wind range from the ensembles when only one or two models are in */
  const ensM = [];
  for (const s of MSRC.filter(x => x.kind === "ens" && srcOn(x))){ const E = G.ens[s.id] && G.ens[s.id][li]; if (!E) continue; const w = srcW(s)/E.length; for (const m of E) if (m[i] != null) ensM.push([m[i], w]); }
  if (!out.rng.ws && ensM.length >= 5) out.rng.ws = wq(ensM.map(x => x[0]), ensM.map(x => x[1]), [M.pct[0]/100, M.pct[1]/100]);
  /* chances: wind from the ensemble members moved by any edit (else a normal spread), seas from a lognormal
     around the official value whose width is the wave models' spread plus error growing with lead time */
  const dW = out.o.ws != null && out.g.ws != null ? out.o.ws - out.g.ws : 0;
  for (const x of M.thr.wind){
    if (out.o.ws == null){ out.p[`w${x}`] = null; continue; }
    if (ensM.length >= 10){ let a = 0, b = 0; for (const [v, w] of ensM){ b += w; if (v + dW >= x) a += w; } out.p[`w${x}`] = Math.round(100*a/b); }
    else { const sd = 2 + 0.08*out.o.ws + 0.4*lead; out.p[`w${x}`] = Math.round(100*(1 - normCdf((x - out.o.ws)/sd))); }
  }
  for (const x of M.thr.seas){
    const v = out.o.wvh; if (v == null){ out.p[`s${x}`] = null; continue; }
    const sv = Object.values(out.srcv.wvh || {}).filter(z => z > 0.2), mu = Math.log(Math.max(0.3, v));
    let sd = 0; if (sv.length >= 2){ const L = sv.map(Math.log), m = L.reduce((a, b) => a + b, 0)/L.length; sd = Math.sqrt(L.reduce((a, b) => a + (b - m)**2, 0)/(L.length - 1)); }
    const s2 = Math.sqrt(sd*sd + (0.10 + 0.03*lead)**2);
    out.p[`s${x}`] = Math.round(100*(1 - normCdf((Math.log(x) - mu)/s2)));
  }
  return out;
}
let CALC = [];
function recompute(){ CALC = ROWS.map(calcRow); }

/* ---------- display ---------- */
function rangeOf(c, k){
  const v = c.o[k]; if (v == null) return null;
  const b = c.rng[k], g = c.g[k], sh = g != null ? v - g : 0;
  let lo = b ? b[0] + sh : v, hi = b ? b[1] + sh : v;
  const cv = Math.round(v), L = Math.max(0, Math.min(Math.round(lo), cv)), Hh = Math.max(Math.round(hi), cv);
  return { lo:L, hi:Hh, text: L === Hh ? String(L) : `${L}–${Hh}` };
}
function cellText(c, k){
  const v = c.o[k]; if (v == null) return "";
  if (DIRK.has(k)) return compass(v);
  if (k === "ws" || HTK.has(k)) return rangeOf(c, k).text;
  if (k === "vis") return v >= 9.95 ? "10+" : v < 3 ? v.toFixed(1) : String(Math.round(v));
  return String(Math.round(v));
}
function wxWords(c){
  const tst = c.o.tst, pop = c.o.pop, vis = c.o.vis;
  let w = tst >= 50 ? "Thunderstorms likely" : tst >= 25 ? "Chance of thunderstorms" : tst >= 10 ? "Isolated thunderstorms" : pop >= 60 ? "Showers likely" : pop >= 30 ? "Chance of showers" : pop >= 15 ? "Isolated showers" : pop == null ? "" : "Dry";
  if (vis != null && vis < 1) w += (w ? ", " : "") + "fog";
  return w;
}
const lvl = (v, thr) => v == null ? 0 : v >= thr[2] ? 3 : v >= thr[1] ? 2 : v >= thr[0] ? 1 : 0;
const COLS = () => [
  ["wd", "From", "Wind"], ["ws", "kt", "Wind"], ["wg", "Gust", "Wind"],
  ["wvh", "ft", "Seas"], ["wvp", "Period", "Seas"], ["wvd", "From", "Seas"],
  ["swh", "ft", "Swell"], ["swp", "Period", "Swell"], ["swd", "From", "Swell"], ["wwh", "ft", "Wind waves"],
  ["wx", "", "Weather"], ["pop", "Rain %", "Weather"], ["tst", "Thunder %", "Weather"], ["vis", "Vis nm", "Weather"], ["t", "Air °F", "Weather"], ["sst", "Water °F", "Weather"],
  ...M.thr.wind.map(x => [`w${x}`, `≥${x} kt`, "Chance of wind"]), ...M.thr.seas.map(x => [`s${x}`, `≥${x} ft`, "Chance of seas"])
];
const EDITABLE = new Set([...ATM, ...WAVEF]);

/* ---------- render ---------- */
function renderAll(){
  buildRows(); recompute();
  renderHeader(); renderRouteForm(); renderMap(); renderTable(); renderSummary(); renderZones(); renderSources(); renderStatus();
}
function renderHeader(){
  $("modeSel").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.m === M.mode));
  $("tzSel").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", (b.dataset.z === "z") === !!M.zulu));
  if (document.activeElement !== $("mTitle")) $("mTitle").value = M.title || "";
  if (document.activeElement !== $("mFc")) $("mFc").value = M.fc || "";
  document.body.classList.toggle("mode-point", M.mode === "point");
}
function renderStatus(){
  const ok = Object.values(G.status).filter(s => s.ok).length, pend = Object.values(G.status).filter(s => s.loading).length;
  $("live").classList.toggle("err", !G.loading && !ok && ROWS.length);
  $("live").textContent = DEMO ? "Demo guidance (synthetic data)" : !ROWS.length ? (M.mode === "route" ? "Add waypoints and a departure time to start" : "Set the point and the time range to start") : pend ? `Loading guidance, ${ok} sources in` : `Guidance from ${ok} sources, fetched ${G.fetchedAt ? tLabel(G.fetchedAt) : ""}`;
  const b = $("banner");
  if (DEMO){ b.className = "banner show demo"; b.textContent = "Demo mode: every value on this page is synthetic. Remove ?demo=1 from the address to load real guidance."; }
  else if (!G.loading && ROWS.length && !ok){ b.className = "banner show"; b.textContent = "Couldn't reach any guidance source from this browser. Check the connection, then press Refresh guidance."; }
  else if (ROWS.length && ROWS.some(r => r.t < TL.t0 || r.t > TL.t0 + TL.n*H)){ b.className = "banner show"; b.textContent = "Some times are outside the guidance (yesterday to about 9 days out); those rows are blank."; }
  else b.className = "banner";
}
function renderRouteForm(){
  const R = M.route, pts = routeTimes();
  const v = (id, val) => { const e = $(id); if (e && document.activeElement !== e) e.value = val; };
  v("rDepart", toLocalInput(R.depart)); v("rSpeed", R.speed); v("rLeg", String(R.legH));
  $("etaSel").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", (b.dataset.e === "auto") === !!R.auto));
  $("rDepartWrap").hidden = !R.auto; $("rSpeedWrap").hidden = !R.auto;
  const tb = $("wpRows");
  if (!document.activeElement || !tb.contains(document.activeElement)){
    let tot = 0;
    tb.innerHTML = R.pts.map((p, i) => {
      const prev = R.pts[i - 1], d = prev && prev.lat != null && p.lat != null ? nmBetween(prev, p) : null; if (d) tot += d;
      const crs = prev && d ? Math.round(course(prev, p)) : null, tt = pts.find(x => x.id === p.id);
      return `<tr data-i="${i}"><td class="n">${i + 1}</td><td><input data-f="name" value="${esc(p.name || "")}" placeholder="Waypoint ${i + 1}" aria-label="Name of waypoint ${i + 1}"></td>
        <td><input data-f="lat" class="mono" value="${p.lat == null ? "" : p.lat.toFixed(4)}" aria-label="Latitude"></td><td><input data-f="lon" class="mono" value="${p.lon == null ? "" : p.lon.toFixed(4)}" aria-label="Longitude"></td>
        <td>${R.auto ? `<span class="mono">${tt && tt.t != null ? tLabel(tt.t) : "–"}</span>` : `<input type="datetime-local" data-f="t" value="${toLocalInput(p.t)}" aria-label="Arrival time">`}</td>
        <td><input data-f="stay" type="number" min="0" max="240" step="0.5" value="${p.stay || 0}" style="width:58px" aria-label="Hours at this waypoint"></td>
        <td class="mut">${d ? `${d.toFixed(1)} nm · ${pad3(crs)}°` : ""}</td>
        <td class="wpb"><button class="ib" data-a="up" aria-label="Move up" ${i ? "" : "disabled"}>↑</button><button class="ib" data-a="down" aria-label="Move down" ${i < R.pts.length - 1 ? "" : "disabled"}>↓</button><button class="ib" data-a="del" aria-label="Remove waypoint ${i + 1}">✕</button></td></tr>`;
    }).join("") || `<tr><td colspan="8" class="mut" style="padding:10px">No waypoints yet. Click the map to add them, type them below, or open a route file.</td></tr>`;
    $("rTotal").textContent = R.pts.length > 1 ? `${tot.toFixed(1)} nm in all${R.auto && pts.length && pts[pts.length - 1].t ? `, arriving ${tLabel(pts[pts.length - 1].t)}` : ""}` : "";
  }
  const P = M.point;
  v("pName", P.name || ""); v("pLat", P.lat == null ? "" : P.lat.toFixed(4)); v("pLon", P.lon == null ? "" : P.lon.toFixed(4));
  v("pStart", toLocalInput(P.start)); v("pEnd", toLocalInput(P.end)); v("pStep", String(P.step || 3));
  const sel = $("savedSel"), names = Object.keys(M.saved || {}).sort();
  sel.innerHTML = `<option value="">Saved routes${names.length ? ` (${names.length})` : ""}</option>` + names.map(n => `<option>${esc(n)}</option>`).join("");
}
const pad3 = n => String(n).padStart(3, "0");

function renderTable(){
  const el = $("tbl");
  if (!ROWS.length){ el.innerHTML = `<p class="mut" style="padding:8px 2px">The forecast appears here once ${M.mode === "route" ? "the route has at least one waypoint with a time" : "the point and times are set"}.</p>`; $("legend").innerHTML = ""; return; }
  const cols = COLS(), groups = [];
  cols.forEach(([k, , g]) => { const x = groups[groups.length - 1]; if (x && x.g === g) x.n++; else groups.push({ g, n:1 }); });
  const R = M.mode === "route";
  let h = `<table class="mt rt"><thead><tr class="gr"><th colspan="${R ? 3 : 1}"></th>${groups.map(g => `<th colspan="${g.n}">${g.g}</th>`).join("")}</tr><tr>`;
  h += `${M.mode === "route" ? `<th class="sl">Where</th>` : ""}<th class="sl">${M.zulu ? "Time (UTC)" : "Time (" + tzAbbr(ROWS[0].t) + ")"}</th>${R ? `<th class="sl">Position</th>` : ""}` + cols.map(([k, l]) => `<th>${l}</th>`).join("") + `</tr></thead><tbody>`;
  let lastDay = null;
  ROWS.forEach((r, ri) => {
    const c = CALC[ri] || { o:{}, p:{}, g:{}, rng:{}, ed:{} }, dk = dayKey(r.t, M.zulu), nd = dk !== lastDay; lastDay = dk;
    h += `<tr class="${r.wp ? "wp" : "leg"}${nd ? " nd" : ""}">${M.mode === "route" ? `<th class="sl">${r.n ? `<span class="wpn">${r.n}</span>` : ""}${esc(r.name)}</th>` : ""}<td class="sl mono">${tLabel(r.t)}</td>${R ? `<td class="sl mono small">${fmtPos(r.lat, r.lon)}</td>` : ""}`;
    for (const [k] of cols){
      let txt = "", cls = "", st = "";
      if (k === "wx") txt = wxWords(c);
      else if (/^[ws]\d/.test(k)){ const v = c.p[k]; txt = v == null ? "" : String(v); if (v != null) st = `background:rgba(var(--p),${(Math.min(0.62, v/100*0.62)).toFixed(3)})`; }
      else { txt = cellText(c, k); if (k === "ws" || k === "wg") cls = `h${lvl(k === "ws" ? c.o.ws : c.o.wg - 5, M.thr.wind)}`; if (k === "wvh") cls = `h${lvl(c.o.wvh, M.thr.seas)}`; }
      const ed = EDITABLE.has(k), edited = c.ed && c.ed[k] !== undefined;
      h += `<td class="${cls}${ed ? " ed" : ""}${edited ? " ov" : ""}"${st ? ` style="${st}"` : ""}${ed ? ` data-r="${ri}" data-k="${k}" tabindex="0" title="${esc(srcTitle(c, k))}"` : ""}>${esc(txt)}</td>`;
    }
    h += `</tr>`;
  });
  el.innerHTML = h + `</tbody></table>`;
  $("legend").innerHTML = `<span><i class="lg h1"></i>at or over ${M.thr.wind[0]} kt / ${M.thr.seas[0]} ft</span><span><i class="lg h2"></i>${M.thr.wind[1]} kt / ${M.thr.seas[1]} ft</span><span><i class="lg h3"></i>${M.thr.wind[2]} kt / ${M.thr.seas[2]} ft</span><span><i class="lg ov"></i>changed by the forecaster</span><span>Wind, seas, swell and wind waves are ranges between the ${ordinalN(M.pct[0])} and ${ordinalN(M.pct[1])} percentiles of the guidance</span>`;
}
function srcTitle(c, k){
  const sv = c.srcv && c.srcv[k]; if (!sv) return "";
  const f = v => DIRK.has(k) ? compass(v) : HTK.has(k) || k === "vis" ? v.toFixed(1) : Math.round(v);
  const parts = Object.entries(sv).map(([id, v]) => `${(MSRC.find(s => s.id === id) || {}).name}: ${f(v)}`);
  return (parts.length ? parts.join("\n") : "No guidance") + "\nClick to change; clear the box to go back to guidance.";
}

/* ---------- editing ---------- */
function startEdit(td){
  const ri = +td.dataset.r, k = td.dataset.k, r = ROWS[ri], c = CALC[ri]; if (!r || !c) return;
  const cur = c.o[k];
  const inp = document.createElement("input"); inp.className = "cellin";
  inp.value = cur == null ? "" : DIRK.has(k) ? compass(cur) : HTK.has(k) || k === "vis" ? String(r1(cur)) : String(Math.round(cur));
  td.textContent = ""; td.appendChild(inp); inp.focus(); inp.select();
  let done = false;
  const finish = ok => {
    if (done) return; done = true;
    if (ok){
      const t = inp.value.trim(); M.edits[r.key] = M.edits[r.key] || {};
      if (!t) delete M.edits[r.key][k];
      else { const v = DIRK.has(k) ? parseDir(t) : parseFloat(t); if (v != null && isFinite(v)) M.edits[r.key][k] = clamp(v, k === "t" || k === "sst" ? -40 : 0, DIRK.has(k) ? 359.9 : k === "pop" || k === "tst" ? 100 : 400); }
      if (!Object.keys(M.edits[r.key]).length) delete M.edits[r.key];
      M.disc = M.disc && M.disc.locked ? M.disc : null; save();
    }
    renderAll();
    const nx = document.querySelector(`#tbl td[data-r="${ri}"][data-k="${k}"]`); if (nx) nx.focus();
  };
  inp.onkeydown = ev => { if (ev.key === "Enter"){ ev.preventDefault(); finish(true); } else if (ev.key === "Escape"){ ev.preventDefault(); finish(false); } };
  inp.onblur = () => finish(true);
}

/* ---------- written summary ---------- */
function autoSummary(){
  if (!ROWS.length || !CALC.some(c => c.o && c.o.ws != null)) return "";
  const at = i => `${ROWS[i].wp && M.mode === "route" ? (ROWS[i].n ? `at ${ROWS[i].n} ${ROWS[i].name}` : ROWS[i].name) : "en route"} (${tLabel(ROWS[i].t)})`;
  const iMax = k => { let b = -1; CALC.forEach((c, i) => { if (c.o && c.o[k] != null && (b < 0 || c.o[k] > CALC[b].o[k])) b = i; }); return b; };
  const parts = [];
  if (M.mode === "route"){
    const pts = routeTimes(); const a = pts[0], z = pts[pts.length - 1];
    if (a && z && a !== z) parts.push(`${M.title ? M.title + ": " : ""}${a.name || "Waypoint 1"} to ${z.name || "waypoint " + pts.length}, leaving ${tLabel(a.t)}${M.route.auto ? ` at ${M.route.speed} kt` : ""} and arriving ${tLabel(z.t)}.`);
  } else if (M.point.lat != null) parts.push(`${M.title ? M.title + ": " : ""}${M.point.name || fmtPos(M.point.lat, M.point.lon)}, ${tLabel(ROWS[0].t)} to ${tLabel(ROWS[ROWS.length - 1].t)}.`);
  const dirs = {}; CALC.forEach(c => { if (c.o && c.o.wd != null){ const d = compass(c.o.wd).replace(/^(.)(.).?$/, "$1$2").replace(/^([NSEW])([NSEW])$/, "$1$2"); dirs[d] = (dirs[d] || 0) + 1; } });
  const dTop = Object.entries(dirs).sort((a, b) => b[1] - a[1])[0];
  const wsI = iMax("ws"), wvI = iMax("wvh"), tsI = iMax("tst");
  if (wsI >= 0){ const c = CALC[wsI], r = rangeOf(c, "ws"); parts.push(`Winds mostly ${dTop ? dTop[0] : ""} ${rangeOf(CALC[0], "ws") ? rangeOf(CALC[0], "ws").text : ""} kt at the start; strongest ${compass(c.o.wd)} ${r.text} kt${c.o.wg != null && c.o.wg >= c.o.ws + 5 ? ` with gusts to ${Math.round(c.o.wg)} kt` : ""} ${at(wsI)}.`); }
  if (wvI >= 0){
    const c = CALC[wvI], r = rangeOf(c, "wvh"), r0 = rangeOf(CALC[0], "wvh");
    parts.push(`Seas ${r0 ? r0.text : "?"} ft at the start${r.hi > (r0 ? r0.hi : 0) ? `, building to ${r.text} ft ${at(wvI)}` : `, highest ${r.text} ft ${at(wvI)}`}${c.o.wvp != null ? ` (dominant period ${Math.round(c.o.wvp)} s)` : ""}.`);
    const sx = M.thr.seas.slice().reverse().find(x => CALC.some(cc => (cc.p[`s${x}`] || 0) >= 30));
    if (sx != null){ let b = -1; CALC.forEach((cc, i) => { if (b < 0 || (cc.p[`s${sx}`] || 0) > (CALC[b].p[`s${sx}`] || 0)) b = i; }); parts.push(`Chance of seas ${sx} ft or more peaks at ${CALC[b].p[`s${sx}`]}% ${at(b)}.`); }
    const swI = iMax("swh"); if (swI >= 0 && CALC[swI].o.swp >= 9) parts.push(`Swell up to ${rangeOf(CALC[swI], "swh").text} ft at ${Math.round(CALC[swI].o.swp)} s from the ${compass(CALC[swI].o.swd)}.`);
  }
  const wx = M.thr.wind.slice().reverse().find(x => CALC.some(cc => (cc.p[`w${x}`] || 0) >= 30));
  if (wx != null){ let b = -1; CALC.forEach((cc, i) => { if (b < 0 || (cc.p[`w${wx}`] || 0) > (CALC[b].p[`w${wx}`] || 0)) b = i; }); parts.push(`Chance of winds ${wx} kt or more peaks at ${CALC[b].p[`w${wx}`]}% ${at(b)}.`); }
  if (tsI >= 0 && CALC[tsI].o.tst >= 15) parts.push(`${CALC[tsI].o.tst >= 50 ? "Thunderstorms likely" : "A chance of thunderstorms"} ${at(tsI)} (${Math.round(CALC[tsI].o.tst)}%).`);
  else parts.push("No thunderstorms expected.");
  const visI = CALC.reduce((b, c, i) => c.o && c.o.vis != null && (b < 0 || c.o.vis < CALC[b].o.vis) ? i : b, -1);
  if (visI >= 0 && CALC[visI].o.vis < 3) parts.push(`Visibility down to ${cellText(CALC[visI], "vis")} nm ${at(visI)}.`);
  return parts.join(" ");
}
function renderSummary(){
  const ta = $("disc"); if (document.activeElement === ta) return;
  const auto = autoSummary();
  ta.value = M.disc && M.disc.text != null ? M.disc.text : auto;
  $("discNote").textContent = M.disc && M.disc.text != null ? "Your wording (automatic text no longer updates)" : "Written from the forecast; it updates as you edit. Type in it to make it yours.";
  if (document.activeElement !== $("remarks")) $("remarks").value = M.remarks || "";
}
const summaryText = () => (M.disc && M.disc.text != null ? M.disc.text : autoSummary());

/* ---------- NWS zones ---------- */
function renderZones(){
  const z = Object.values(G.cwf), el = $("zones");
  $("zonesPanel").hidden = !ROWS.length;
  $("zInc").checked = M.zonesInProduct !== false;
  if (!z.length){ el.innerHTML = `<p class="mut">${G.loading ? "Looking up the NWS marine zones" : "No NWS coastal or offshore waters zone at these positions."}</p>`; return; }
  el.innerHTML = z.map(c => `<div class="zone"><div class="zh"><b>${esc(c.id)}</b> ${esc(c.name)} <span class="mut">${M.mode === "route" ? `· waypoint${c.at.length > 1 ? "s" : ""} ${esc(c.at.join(", "))}` : ""}${c.updated ? ` · updated ${esc(tLabel(Date.parse(c.updated)))}` : ""}</span> <a href="https://forecast.weather.gov/shmrn.php?mz=${encodeURIComponent(c.id.toLowerCase())}" target="_blank" rel="noopener">Full forecast</a></div>
    <dl class="cwf">${c.periods.slice(0, 4).map(p => `<dt>${esc(p.name)}</dt><dd>${esc(p.text)}</dd>`).join("")}</dl></div>`).join("");
}

/* ---------- sources panel ---------- */
function renderSources(){
  const groups = {}; MSRC.forEach(s => (groups[s.grp] = groups[s.grp] || []).push(s));
  $("srcGrid").innerHTML = Object.entries(groups).map(([g, list]) => `<div><h3>${g}</h3>${list.map(s => { const st = G.status[s.id] || {}, txt = st.loading ? "loading" : st.ok ? st.note || "loaded" : st.err || "not loaded";
    return `<div class="srow ${st.ok ? "" : "na"}"><input type="checkbox" data-src="${s.id}" ${srcOn(s) ? "checked" : ""} aria-label="Use ${esc(s.name)}"><span>${esc(s.name)} <span class="st">${esc(txt)}</span></span><span class="sp"></span><input class="w" type="number" min="0" max="5" step="0.5" data-w="${s.id}" value="${srcW(s)}" aria-label="Weight for ${esc(s.name)}"></div>`; }).join("")}</div>`).join("");
  const used = MSRC.filter(s => (G.status[s.id] || {}).ok && srcOn(s)).length;
  $("srcSum").textContent = `${used} in use`;
}

/* ---------- map (offline coastline: Natural Earth) ---------- */
let COAST = null, COAST_LOADING = false;
async function loadCoast(){
  if (COAST || COAST_LOADING) return; COAST_LOADING = true;
  try {
    const js = window.ERWX_COAST || await getJSON(`${typeof DATA_BASE !== "undefined" ? DATA_BASE : ""}data/coast.json`, 20000);
    const dec = (rings, q) => rings.map(a => { const out = []; let x = 0, y = 0; for (let i = 0; i < a.length; i += 2){ x += a[i]; y += a[i + 1]; out.push([x/q, y/q]); } let b = [180, 90, -180, -90]; for (const [lo, la] of out){ if (lo < b[0]) b[0] = lo; if (la < b[1]) b[1] = la; if (lo > b[2]) b[2] = lo; if (la > b[3]) b[3] = la; } out.bb = b; return out; });
    COAST = { world: dec(js.world.rings, js.world.q), detail: dec(js.detail.rings, js.detail.q), box: js.detail.box };
  } catch (e) { COAST = { world:[], detail:[], box:null, err:true }; }
  COAST_LOADING = false; renderMap();
}
const MAPH = 430;
/* Web Mercator (basemap.js), so the map tiles line up; k = pixels per degree of longitude */
function mapProj(W, Hh, v){ return ERWXBase.proj(W, Hh, v); }
/* rings in view, with points far outside the view pinned to a margin around it (off screen, so the pinned
   edges never show) and near-duplicate points dropped: keeps the drawing and the products small */
function viewRings(rings, bb, cb){
  const mx = (bb[2] - bb[0])*0.08, my = (bb[3] - bb[1])*0.08, E = [bb[0] - mx, bb[1] - my, bb[2] + mx, bb[3] + my];
  for (const r of rings){
    const b = r.bb; if (b[2] < bb[0] || b[0] > bb[2] || b[3] < bb[1] || b[1] > bb[3]) continue;
    const out = []; let pl = null, pa = null;
    for (const [lo0, la0] of r){ const lo = Math.min(E[2], Math.max(E[0], lo0)), la = Math.min(E[3], Math.max(E[1], la0)); if (lo === pl && la === pa) continue; out.push([lo, la]); pl = lo; pa = la; }
    if (out.length > 2) cb(out);
  }
}
function ringsPath(rings, pr, bb){
  let d = "";
  viewRings(rings, bb, r => {
    let px = null, py = null, s = "";
    for (const [lo, la] of r){ const x = pr.x(lo), y = pr.y(la); if (px != null && Math.abs(x - px) < 0.6 && Math.abs(y - py) < 0.6) continue; s += (s ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1); px = x; py = y; }
    if (s) d += s + "Z";
  });
  return d;
}
function mapPoints(){
  if (M.mode === "point") return M.point.lat != null ? [{ id:"p", n:"", name:M.point.name || "Point", lat:M.point.lat, lon:M.point.lon }] : [];
  return M.route.pts.filter(p => p.lat != null && p.lon != null).map((p, i) => ({ ...p, n:String(M.route.pts.indexOf(p) + 1) }));
}
function mapSVG(W, Hh, v, opts){
  opts = opts || {};
  const pr = mapProj(W, Hh, v), bb = pr.bb, pts = opts.pts || mapPoints();
  let land = "", det = "";
  if (COAST && COAST.world){
    const useDet = COAST.box && v.k > 60 && bb[2] > COAST.box[0] && bb[0] < COAST.box[2] && bb[3] > COAST.box[1] && bb[1] < COAST.box[3];
    land = ringsPath(COAST.world, pr, bb);
    if (useDet) det = ringsPath(COAST.detail, pr, bb);
  }
  const cb = COAST && COAST.box ? `<clipPath id="dbx${opts.id || ""}"><rect x="${pr.x(COAST.box[0]).toFixed(1)}" y="${pr.y(COAST.box[3]).toFixed(1)}" width="${(pr.x(COAST.box[2]) - pr.x(COAST.box[0])).toFixed(1)}" height="${(pr.y(COAST.box[1]) - pr.y(COAST.box[3])).toFixed(1)}"/></clipPath>` : "";
  /* when the detailed coast is drawn, mask the coarse one inside its box */
  const coarseMask = det ? `<mask id="cm${opts.id || ""}"><rect width="${W}" height="${Hh}" fill="#fff"/><rect x="${pr.x(COAST.box[0]).toFixed(1)}" y="${pr.y(COAST.box[3]).toFixed(1)}" width="${(pr.x(COAST.box[2]) - pr.x(COAST.box[0])).toFixed(1)}" height="${(pr.y(COAST.box[1]) - pr.y(COAST.box[3])).toFixed(1)}" fill="#000"/></mask>` : "";
  /* graticule */
  const span = bb[2] - bb[0], step = span > 40 ? 10 : span > 16 ? 5 : span > 6 ? 2 : span > 2.5 ? 1 : 0.5;
  let grid = "", glab = "";
  for (let lo = Math.ceil(bb[0]/step)*step; lo <= bb[2]; lo += step){ const x = pr.x(lo); grid += `M${x.toFixed(1)},0V${Hh}`; glab += `<text x="${(x + 3).toFixed(1)}" y="${Hh - 5}" class="gl">${Math.abs(lo).toFixed(step < 1 ? 1 : 0)}°${lo < 0 ? "W" : "E"}</text>`; }
  for (let la = Math.ceil(bb[1]/step)*step; la <= bb[3]; la += step){ const y = pr.y(la); grid += `M0,${y.toFixed(1)}H${W}`; glab += `<text x="4" y="${(y - 3).toFixed(1)}" class="gl">${Math.abs(la).toFixed(step < 1 ? 1 : 0)}°${la < 0 ? "S" : "N"}</text>`; }
  const line = pts.length > 1 ? `<path d="${pts.map((p, i) => (i ? "L" : "M") + pr.x(p.lon).toFixed(1) + "," + pr.y(p.lat).toFixed(1)).join("")}" class="rl"/>` : "";
  const dots = (opts.rows || []).filter(r => !r.wp).map(r => `<circle cx="${pr.x(r.lon).toFixed(1)}" cy="${pr.y(r.lat).toFixed(1)}" r="2.6" class="rd"/>`).join("");
  const marks = pts.map(p => `<g class="wpm" data-id="${esc(p.id)}"><circle cx="${pr.x(p.lon).toFixed(1)}" cy="${pr.y(p.lat).toFixed(1)}" r="${opts.print ? 7 : 10}" class="wc"/><text x="${pr.x(p.lon).toFixed(1)}" y="${(pr.y(p.lat) + (opts.print ? 3 : 4)).toFixed(1)}" class="wn">${esc(p.n || "•")}</text>${p.name ? `<text x="${(pr.x(p.lon) + 13).toFixed(1)}" y="${(pr.y(p.lat) - 9).toFixed(1)}" class="wl">${esc(p.name)}</text>` : ""}</g>`).join("");
  return `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" class="mapsvg" role="img" aria-label="${M.mode === "route" ? "Route map" : "Point map"}" xmlns="http://www.w3.org/2000/svg">
    <defs>${cb}${coarseMask}</defs><rect width="${W}" height="${Hh}" class="sea"/><path d="${land}" class="land"${coarseMask ? ` mask="url(#cm${opts.id || ""})"` : ""}/>${det ? `<path d="${det}" class="land" clip-path="url(#dbx${opts.id || ""})"/>` : ""}
    ${opts.print ? "" : ERWXBase.tiles(W, Hh, v)}<path d="${grid}" class="grid"/>${glab}${line}${dots}${marks}
    ${opts.print ? "" : `<text x="${W - 5}" y="${Hh - 5}" class="attr">${esc(ERWXBase.attribution())}</text>`}</svg>`;
}
function renderMap(){
  if (!COAST) loadCoast();
  const box = $("map"), W = Math.max(320, Math.round(box.clientWidth || 760));
  box.innerHTML = mapSVG(W, MAPH, M.view, { rows: ROWS });
  $("mapHint").textContent = COAST && COAST.err ? "Coastline file not found (data/coast.json); the grid still works." : M.mode === "route" ? "Click the map to add a waypoint, drag one to move it, drag the map to pan, scroll or use + and − to zoom." : "Click the map to set the point; drag the map to pan, scroll or use + and − to zoom.";
}
function bindMap(){
  const box = $("map"); let drag = null;
  const pt = ev => { const r = box.getBoundingClientRect(); return { x:ev.clientX - r.left, y:ev.clientY - r.top, W:r.width }; };
  box.addEventListener("pointerdown", ev => {
    const p = pt(ev), g = ev.target.closest && ev.target.closest(".wpm");
    drag = { x0:p.x, y0:p.y, v0:{ ...M.view }, id: g ? g.dataset.id : null, moved:false };
    box.setPointerCapture(ev.pointerId);
  });
  box.addEventListener("pointermove", ev => {
    if (!drag) return; const p = pt(ev), dx = p.x - drag.x0, dy = p.y - drag.y0;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; if (!drag.moved) return;
    const pr = mapProj(p.W, MAPH, drag.v0);
    if (drag.id){
      const lo = pr.lon(p.x), la = pr.lat(p.y);
      if (drag.id === "p"){ M.point.lat = la; M.point.lon = lo; } else { const w = M.route.pts.find(q => q.id === drag.id); if (w){ w.lat = la; w.lon = lo; } }
      buildRows(); renderMap();
    } else { const v = ERWXBase.panned(p.W, MAPH, drag.v0, dx, dy); M.view.lon = v.lon; M.view.lat = v.lat; renderMap(); }
  });
  box.addEventListener("pointerup", ev => {
    if (!drag) return; const p = pt(ev), d = drag; drag = null;
    if (d.moved){ save(); if (d.id) changed(); return; }
    if (d.id) return;
    const pr = mapProj(p.W, MAPH, M.view), lo = pr.lon(p.x), la = pr.lat(p.y);
    if (M.mode === "point"){ M.point.lat = la; M.point.lon = lo; }
    else M.route.pts.push({ id:uid(), name:"", lat:la, lon:lo, stay:0, t:null });
    changed();
  });
  box.addEventListener("wheel", ev => { ev.preventDefault(); zoomAt(ev.deltaY < 0 ? 1.25 : 0.8, pt(ev)); }, { passive:false });
  ERWXBase.bindPicker($("mapStyle"), renderMap);
  $("zIn").onclick = () => zoomAt(1.5); $("zOut").onclick = () => zoomAt(1/1.5); $("zFit").onclick = fitMap;
}
function zoomAt(f, p){
  const W = $("map").clientWidth || 760, pr = mapProj(W, MAPH, M.view);
  const lo = p ? pr.lon(p.x) : M.view.lon, la = p ? pr.lat(p.y) : M.view.lat;
  M.view.k = clamp(M.view.k*f, 4, 20000);
  if (p){ const q = mapProj(W, MAPH, M.view); M.view.lon += lo - q.lon(p.x); M.view.lat += la - q.lat(p.y); }
  save(); renderMap();
}
function fitView(pts, W, Hh){
  if (!pts.length) return { ...M.view };
  const la = pts.map(p => p.lat), lo = pts.map(p => p.lon), c = { lat:(Math.min(...la) + Math.max(...la))/2, lon:(Math.min(...lo) + Math.max(...lo))/2 };
  const pad = 0.075, laS = Math.min(...la) - pad, laN = Math.max(...la) + pad, dlo = Math.max(0.15, Math.max(...lo) - Math.min(...lo));
  c.lat = (laS + laN)/2;
  const k = ERWXBase.fitK(dlo, laS, laN, W - 90, Hh - 70);
  return { lat:c.lat, lon:c.lon, k: clamp(k, 4, 1300) };
}
function fitMap(){ const pts = mapPoints(); if (!pts.length) return; M.view = fitView(pts, $("map").clientWidth || 760, MAPH); save(); renderMap(); }

/* ---------- route editing ---------- */
let _ch = 0;
function changed(){
  save(); buildRows(); renderAll();
  /* new positions or times need guidance: refetch after a short pause */
  clearTimeout(_ch); _ch = setTimeout(() => { const need = locsFor(ROWS.map(r => ({ ...r }))).some(l => G.byKey[l.key] == null); if (need) loadAll(); }, 900);
}
function bindRoute(){
  const tb = $("wpRows");
  tb.addEventListener("change", ev => {
    const tr = ev.target.closest("tr[data-i]"); if (!tr) return; const p = M.route.pts[+tr.dataset.i], f = ev.target.dataset.f; if (!p || !f) return;
    const v = ev.target.value;
    if (f === "name") p.name = v.trim();
    else if (f === "lat" || f === "lon"){ const n = parseCoord(v); p[f] = n == null ? null : f === "lat" ? clamp(n, -85, 85) : ((n + 540) % 360) - 180; }
    else if (f === "t") p.t = fromLocalInput(v);
    else if (f === "stay") p.stay = Math.max(0, +v || 0);
    changed();
  });
  tb.addEventListener("click", ev => {
    const b = ev.target.closest("button[data-a]"); if (!b) return; const i = +b.closest("tr").dataset.i, P = M.route.pts;
    if (b.dataset.a === "del") P.splice(i, 1);
    if (b.dataset.a === "up" && i > 0) [P[i - 1], P[i]] = [P[i], P[i - 1]];
    if (b.dataset.a === "down" && i < P.length - 1) [P[i + 1], P[i]] = [P[i], P[i + 1]];
    changed();
  });
  $("wpAdd").onclick = () => { const L = M.route.pts[M.route.pts.length - 1]; M.route.pts.push({ id:uid(), name:"", lat: L ? L.lat : null, lon: L ? L.lon + 0.3 : null, stay:0, t:null }); changed(); };
  $("wpClear").onclick = () => { if (M.route.pts.length && !confirm("Remove every waypoint?")) return; M.route.pts = []; M.edits = {}; M.disc = null; changed(); };
  $("rDepart").onchange = ev => { M.route.depart = fromLocalInput(ev.target.value); changed(); };
  $("rNow").onclick = () => { M.route.depart = Math.ceil(Date.now()/H)*H; changed(); };
  $("rSpeed").onchange = ev => { M.route.speed = clamp(+ev.target.value || 10, 0.5, 60); changed(); };
  $("rLeg").onchange = ev => { M.route.legH = +ev.target.value; changed(); };
  $("etaSel").onclick = ev => { const b = ev.target.closest("button[data-e]"); if (!b) return;
    if (b.dataset.e === "fixed" && M.route.auto){ routeTimes().forEach(p => { const q = M.route.pts.find(x => x.id === p.id); if (q) q.t = p.t; }); }
    M.route.auto = b.dataset.e === "auto"; changed(); };
  /* single point */
  const pv = () => { const P = M.point; P.name = $("pName").value.trim(); P.lat = parseCoord($("pLat").value); P.lon = parseCoord($("pLon").value); P.start = fromLocalInput($("pStart").value); P.end = fromLocalInput($("pEnd").value); P.step = +$("pStep").value || 3; changed(); };
  ["pName","pLat","pLon","pStart","pEnd","pStep"].forEach(id => $(id).onchange = pv);
  /* saved routes and files */
  $("savedSel").onchange = ev => { const n = ev.target.value; if (!n) return; const s = M.saved[n]; if (s){ M.mode = s.mode; M.title = s.title || ""; M.route = structuredClone(s.route); M.point = structuredClone(s.point || DEF.point); M.edits = {}; M.disc = null; fitMap(); changed(); } ev.target.value = ""; };
  $("saveAs").onclick = () => { const n = prompt("Save this route as", M.title || ""); if (!n) return; M.saved[n.trim()] = { mode:M.mode, title:M.title, route:structuredClone(M.route), point:structuredClone(M.point) }; save(); renderRouteForm(); toast(`Saved "${n.trim()}" on this computer`); };
  $("delSaved").onclick = () => { const names = Object.keys(M.saved || {}); if (!names.length) return toast("No saved routes"); const n = prompt(`Delete which saved route?\n${names.join("\n")}`); if (n && M.saved[n]){ delete M.saved[n]; save(); renderRouteForm(); } };
  $("fileOpen").onchange = async ev => { const f = ev.target.files[0]; ev.target.value = ""; if (!f) return; try { importRoute(await f.text(), f.name); } catch (e) { toast("Couldn't read that file: " + e.message); } };
  $("fileSave").onclick = () => download(new Blob([JSON.stringify({ kind:"erwx-marine-route", v:1, mode:M.mode, title:M.title, route:M.route, point:M.point }, null, 2)], { type:"application/json" }), `${fname()}_route.json`);
}
function importRoute(text, name){
  text = String(text);
  if (/<gpx[\s>]/i.test(text)){
    const doc = new DOMParser().parseFromString(text, "application/xml");
    let nodes = [...doc.getElementsByTagName("rtept")]; if (!nodes.length) nodes = [...doc.getElementsByTagName("wpt")]; if (!nodes.length) nodes = [...doc.getElementsByTagName("trkpt")].filter((_, i, a) => i % Math.max(1, Math.ceil(a.length/30)) === 0);
    const pts = nodes.map(n => { const nm = n.getElementsByTagName("name")[0], tm = n.getElementsByTagName("time")[0]; return { id:uid(), name: nm ? nm.textContent.trim() : "", lat:+n.getAttribute("lat"), lon:+n.getAttribute("lon"), stay:0, t: tm ? Date.parse(tm.textContent) : null }; }).filter(p => isFinite(p.lat) && isFinite(p.lon));
    if (!pts.length) throw new Error("no route points in the GPX file");
    M.mode = "route"; M.route.pts = pts; if (pts.every(p => p.t)) M.route.auto = false;
  } else if (/^\s*\{/.test(text)){
    const js = JSON.parse(text); if (js.kind !== "erwx-marine-route") throw new Error("not a marine route file");
    M.mode = js.mode || "route"; M.title = js.title || ""; M.route = Object.assign(structuredClone(DEF.route), js.route || {}); M.point = Object.assign(structuredClone(DEF.point), js.point || {});
  } else {
    /* CSV: name, lat, lon[, time] */
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean), pts = [];
    for (const l of lines){ const c = l.split(/[,\t;]/).map(x => x.trim()); if (c.length < 3) continue; const la = parseCoord(c[1]), lo = parseCoord(c[2]); if (la == null || lo == null || !isFinite(la)) continue; pts.push({ id:uid(), name:c[0], lat:la, lon:lo, stay:0, t: c[3] ? (Date.parse(c[3]) || fromLocalInput(c[3].replace(" ", "T"))) : null }); }
    if (!pts.length) throw new Error("no rows with name, lat, lon");
    M.mode = "route"; M.route.pts = pts; if (pts.every(p => p.t)) M.route.auto = false;
  }
  M.edits = {}; M.disc = null; fitMap(); changed(); toast(`Opened ${name}`);
}

/* ---------- products ---------- */
const fname = () => `${(M.title || (M.mode === "route" ? "Marine_route" : "Marine_point")).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "Marine"}_${new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "_")}Z`;
function download(blob, name){ const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
function toast(msg){ const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 3200); }
function needData(){ if (!ROWS.length){ toast(M.mode === "route" ? "Add waypoints with times first" : "Set the point and times first"); return true; } if (!M.fc){ toast("Add your initials (Forecaster) first"); $("mFc").focus(); return true; } return false; }
const prodTitle = () => M.mode === "route" ? "MARINE ROUTE FORECAST" : "MARINE POINT FORECAST";
const issuedAt = () => Date.now();
function textProduct(){
  const L = [], it = issuedAt();
  L.push(prodTitle()); if (M.title) L.push(M.title.toUpperCase()); L.push(`45TH WEATHER SQUADRON · ISSUED ${tLong(it).toUpperCase()} · FORECASTER ${M.fc || ""}`); L.push("");
  const sum = summaryText(); if (sum){ L.push(sum); L.push(""); }
  if (M.remarks){ L.push("REMARKS: " + M.remarks); L.push(""); }
  ROWS.forEach((r, i) => {
    const c = CALC[i]; if (!c) return;
    const where = M.mode === "route" ? (r.wp ? `${r.n ? r.n + " " : ""}${r.name}` : r.name) : (M.point.name || "POINT");
    L.push(`${tLabel(r.t)}  ${where.toUpperCase()} (${fmtPos(r.lat, r.lon)})`);
    L.push(`   WIND ${c.o.wd != null ? compass(c.o.wd) : "?"} ${cellText(c, "ws")} KT${c.o.wg != null ? " G" + Math.round(c.o.wg) : ""}  SEAS ${cellText(c, "wvh") || "?"} FT${c.o.wvp != null ? " @ " + Math.round(c.o.wvp) + " S" : ""}${c.o.swh != null ? `  SWELL ${c.o.swd != null ? compass(c.o.swd) + " " : ""}${cellText(c, "swh")} FT${c.o.swp != null ? " @ " + Math.round(c.o.swp) + " S" : ""}` : ""}  ${wxWords(c).toUpperCase()}${c.o.vis != null ? "  VIS " + cellText(c, "vis") + " NM" : ""}`);
  });
  if (M.zonesInProduct !== false && Object.keys(G.cwf).length){ L.push(""); L.push("NWS MARINE FORECASTS"); for (const z of Object.values(G.cwf)){ L.push(`${z.id} ${z.name}`); z.periods.slice(0, 3).forEach(p => L.push(`   ${p.name.toUpperCase()}: ${p.text}`)); } }
  L.push(""); L.push(`Ranges: ${ordinalN(M.pct[0])} to ${ordinalN(M.pct[1])} percentile of the guidance. Seas are significant wave height.`);
  return L.join("\n");
}
function csvProduct(){
  const cols = ["time_utc", "time_local", "where", "lat", "lon", "wind_from_deg", "wind_kt", "wind_lo_kt", "wind_hi_kt", "gust_kt", "seas_ft", "seas_lo_ft", "seas_hi_ft", "period_s", "waves_from_deg", "swell_ft", "swell_period_s", "swell_from_deg", "wind_waves_ft", "rain_pct", "thunder_pct", "vis_nm", "air_f", "water_f", ...M.thr.wind.map(x => `p_wind_ge${x}kt_pct`), ...M.thr.seas.map(x => `p_seas_ge${x}ft_pct`)];
  const q = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
  const lines = [cols.join(",")];
  ROWS.forEach((r, i) => { const c = CALC[i] || { o:{}, p:{} }, rw = rangeOf(c, "ws") || {}, rs = rangeOf(c, "wvh") || {}, o = k => c.o[k] == null ? "" : r1(c.o[k]);
    lines.push([new Date(r.t).toISOString().slice(0, 16) + "Z", toLocalInput(r.t), q(r.wp ? r.name : "En route"), r.lat.toFixed(4), r.lon.toFixed(4), o("wd"), o("ws"), rw.lo ?? "", rw.hi ?? "", o("wg"), o("wvh"), rs.lo ?? "", rs.hi ?? "", o("wvp"), o("wvd"), o("swh"), o("swp"), o("swd"), o("wwh"), o("pop"), o("tst"), o("vis"), o("t"), o("sst"), ...M.thr.wind.map(x => c.p[`w${x}`] ?? ""), ...M.thr.seas.map(x => c.p[`s${x}`] ?? "")].join(",")); });
  return lines.join("\n");
}
function htmlProduct(){
  const it = issuedAt(), cols = COLS();
  const pts = mapPoints(), view = fitView(pts.length ? pts : [{ lat:M.view.lat, lon:M.view.lon }], 760, 360);
  const map = mapSVG(760, 360, view, { rows: ROWS, id:"h", print:true });
  const rows = ROWS.map((r, ri) => { const c = CALC[ri] || { o:{}, p:{} }; return `<tr class="${r.wp ? "wp" : "leg"}">${M.mode === "route" ? `<th>${r.n ? `<b>${r.n}</b> ` : ""}${esc(r.name)}</th>` : ""}<td>${tLabel(r.t)}</td>${M.mode === "route" ? `<td class="sm">${fmtPos(r.lat, r.lon)}</td>` : ""}${cols.map(([k]) => { if (k === "wx") return `<td class="wx">${esc(wxWords(c))}</td>`; if (/^[ws]\d/.test(k)){ const v = c.p[k]; return `<td style="${v == null ? "" : `background:rgba(11,110,121,${(Math.min(.55, v/100*.55)).toFixed(3)})`}">${v ?? ""}</td>`; } const cls = k === "ws" ? `h${lvl(c.o.ws, M.thr.wind)}` : k === "wvh" ? `h${lvl(c.o.wvh, M.thr.seas)}` : ""; return `<td class="${cls}">${esc(cellText(c, k))}</td>`; }).join("")}</tr>`; }).join("");
  const groups = []; cols.forEach(([, , g]) => { const x = groups[groups.length - 1]; if (x && x.g === g) x.n++; else groups.push({ g, n:1 }); });
  const zones = M.zonesInProduct !== false ? Object.values(G.cwf).map(z => `<div class="zone"><b>${esc(z.id)}</b> ${esc(z.name)}<dl>${z.periods.slice(0, 4).map(p => `<dt>${esc(p.name)}</dt><dd>${esc(p.text)}</dd>`).join("")}</dl></div>`).join("") : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(prodTitle())}${M.title ? " · " + esc(M.title) : ""}</title>
<style>body{margin:0;background:#EEF2F1;color:#13202E;font:13px/1.45 "Segoe UI",system-ui,Arial,sans-serif}.wrap{max-width:1180px;margin:0 auto;padding:16px}
header{display:flex;gap:14px;align-items:center;background:#10284A;color:#fff;padding:12px 16px;border-radius:10px}header img{height:58px}header h1{margin:0;font-size:20px;letter-spacing:.3px}header .m{margin-left:auto;text-align:right;font-size:12.5px;line-height:1.5}
.two{display:grid;grid-template-columns:minmax(0,760px) 1fr;gap:14px;margin:14px 0}@media(max-width:1000px){.two{grid-template-columns:1fr}}.card{background:#fff;border:1px solid #D4DBDF;border-radius:10px;padding:12px 14px}
.mapsvg{width:100%;height:auto;display:block;border-radius:8px}.sea{fill:#DCEAF2}.land{fill:#D8D2BE;stroke:#9C9478;stroke-width:.6}.grid{stroke:#9DB4C4;stroke-width:.5;fill:none;opacity:.7}.gl{font:10px sans-serif;fill:#4B5A68}.rl{fill:none;stroke:#0B6E79;stroke-width:2.4}.rd{fill:#0B6E79}.wc{fill:#0B6E79;stroke:#fff;stroke-width:1.5}.wn{font:700 9px sans-serif;fill:#fff;text-anchor:middle}.wl{font:600 11px sans-serif;fill:#13202E;paint-order:stroke;stroke:#fff;stroke-width:3px}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;background:#fff;font-size:12px}th,td{border:1px solid #D4DBDF;padding:4px 6px;text-align:center;white-space:nowrap}thead th{background:#F3F6F7;font-size:11.5px}tbody th{text-align:left}tr.leg{color:#4B5A68;font-style:italic}tr.leg th{font-weight:500}td.sm{font-size:11px;color:#4B5A68}td.wx{text-align:left}
.h1{background:#FCEFC9}.h2{background:#F7CF9A}.h3{background:#EE9A86}h2{font-size:15px;margin:0 0 6px}.zone{margin:8px 0}.zone dl{display:grid;grid-template-columns:max-content 1fr;gap:3px 12px;margin:4px 0}.zone dt{font-weight:700}.zone dd{margin:0}.note{color:#4B5A68;font-size:11.5px;margin-top:12px}</style></head>
<body><div class="wrap"><header>${LOGO_DATA ? `<img src="${LOGO_DATA}" alt="">` : ""}<div><h1>${esc(prodTitle())}</h1><div>${esc([M.title, M.mode === "point" && M.point.lat != null ? `${M.point.name ? M.point.name + ", " : ""}${fmtPos(M.point.lat, M.point.lon)}` : ""].filter(Boolean).join(" · "))}</div></div><div class="m">45th Weather Squadron<br>Issued ${esc(tLong(it))}<br>Forecaster ${esc(M.fc)}</div></header>
<div class="two"><div class="card">${map}</div><div class="card"><h2>Summary</h2><p>${esc(summaryText())}</p>${M.remarks ? `<h2>Remarks</h2><p>${esc(M.remarks)}</p>` : ""}</div></div>
<div class="card tw"><table><thead><tr><th colspan="${M.mode === "route" ? 3 : 1}"></th>${groups.map(g => `<th colspan="${g.n}">${g.g}</th>`).join("")}</tr><tr>${M.mode === "route" ? "<th>Where</th><th>Time</th><th>Position</th>" : "<th>Time</th>"}${cols.map(([, l]) => `<th>${esc(l)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
${zones ? `<div class="card" style="margin-top:14px"><h2>NWS marine forecasts</h2>${zones}</div>` : ""}
<p class="note">${esc(notesText())}</p></div></body></html>`;
}
function notesText(){
  return `Wind in knots at 10 m; seas are the significant wave height in feet. Wind, seas, swell and wind waves are given as the range between the ${ordinalN(M.pct[0])} and ${ordinalN(M.pct[1])} percentiles of the guidance. Chances of strong wind come from the GEFS and ECMWF ensembles; chances of high seas from the spread of the wave models plus the usual forecast error at that lead time. Times are ${M.zulu ? "UTC" : "local (" + tzAbbr(Date.now()) + ")"}. Positions between waypoints assume a straight track at constant speed.`;
}
let LOGO_DATA = null;
async function loadLogoData(){ try { const r = await fetch(LOGO_SRC); if (!r.ok) return; const b = await r.blob(); LOGO_DATA = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); } catch (e) { /* no logo */ } }

/* PDF: letter landscape. Page 1: header, map and summary; then the table; NWS zone text and notes last */
async function pdfProduct(){
  const logo = await (async () => { try { const r = await fetch(LOGO_SRC); if (!r.ok) return null; return await decodeImage(new Uint8Array(await r.arrayBuffer()), r.headers.get("content-type") || "image/png"); } catch (e) { return null; } })();
  const W = 792, Hp = 612, X0 = 24, X1 = 768, pages = []; let cs = [];
  const f = n => (+n).toFixed(2), rgbf = c => c.map(v => f(v/255)).join(" ");
  const rect = (x, y, w, h, c) => cs.push(`${rgbf(c)} rg ${f(x)} ${f(Hp - y - h)} ${f(w)} ${f(h)} re f`);
  const box = (x, y, w, h, lw, c) => cs.push(`${rgbf(c || [0,0,0])} RG ${f(lw || .5)} w ${f(x)} ${f(Hp - y - h)} ${f(w)} ${f(h)} re S`);
  const fit = (s, mw, size, b) => { let z = size; while (z > 4.5 && textW(s, z, b) > mw) z -= .25; return z; };
  const text = (s, x, y, size, o = {}) => { s = String(s ?? ""); const z = o.max ? fit(s, o.max, size, o.bold) : size, w = textW(s, z, o.bold); const tx = o.align === "c" ? x - w/2 : o.align === "r" ? x - w : x; cs.push(`BT /${o.bold ? (o.it ? "F4" : "F2") : (o.it ? "F3" : "F1")} ${f(z)} Tf ${rgbf(o.color || [19,32,46])} rg ${f(tx)} ${f(Hp - y)} Td ${pdfStr(s)} Tj ET`); };
  const wrap = (s, mw, size, b) => { const out = []; for (const para of String(s).split("\n")){ let line = ""; for (const w of para.split(/\s+/)){ const t = line ? line + " " + w : w; if (textW(t, size, b) > mw && line){ out.push(line); line = w; } else line = t; } out.push(line); } return out; };
  const NAVY = [16,40,72], TEAL = [11,110,121], it = issuedAt();
  const header = (cont) => {
    rect(X0, 20, X1 - X0, 50, NAVY);
    if (logo){ const lh = 42, lw = lh*logo.rw/logo.rh; cs.push(`q ${f(lw)} 0 0 ${f(lh)} ${f(X0 + 6)} ${f(Hp - 24 - lh)} cm /Im1 Do Q`); }
    text(prodTitle() + (cont ? " (continued)" : ""), X0 + 60, 40, 14, { bold:true, color:[255,255,255] });
    const sub = [M.title, M.mode === "point" && M.point.lat != null ? `${M.point.name ? M.point.name + ", " : ""}${fmtPos(M.point.lat, M.point.lon)}` : ""].filter(Boolean).join(" · ");
    if (sub) text(sub, X0 + 60, 58, 10.5, { color:[220,230,240], max:440 });
    text("45th Weather Squadron", X1 - 8, 36, 9, { align:"r", color:[255,255,255], bold:true });
    text(`Issued ${tLong(it)}`, X1 - 8, 49, 8.5, { align:"r", color:[220,230,240] });
    text(`Forecaster ${M.fc}`, X1 - 8, 61, 8.5, { align:"r", color:[220,230,240] });
  };
  const flush = () => { pages.push(cs.join("\n")); cs = []; };
  header(false);
  /* map (vector): land polygons clipped to the map box */
  const MX = X0, MY = 80, MW = 440, MH = 250, pts = mapPoints(), v = fitView(pts.length ? pts : [{ lat:M.view.lat, lon:M.view.lon }], MW, MH), pr = mapProj(MW, MH, v);
  rect(MX, MY, MW, MH, [220,234,242]);
  cs.push(`q ${f(MX)} ${f(Hp - MY - MH)} ${f(MW)} ${f(MH)} re W n`);
  const poly = rings => viewRings(rings, pr.bb, r => { let s = "", px = null, py = null; for (const [lo, la] of r){ const x = MX + pr.x(lo), y = Hp - MY - pr.y(la); if (px != null && Math.abs(x - px) < .4 && Math.abs(y - py) < .4) continue; s += `${f(x)} ${f(y)} ${s ? "l" : "m"} `; px = x; py = y; } if (s) cs.push(`${s}h f`); });
  if (!COAST) await loadCoast();
  if (COAST && COAST.world){
    cs.push(`${rgbf([216,210,190])} rg`);
    const useDet = COAST.box && v.k > 60 && pr.bb[2] > COAST.box[0] && pr.bb[0] < COAST.box[2] && pr.bb[3] > COAST.box[1] && pr.bb[1] < COAST.box[3];
    if (useDet){
      /* outside the detail box: the world coast; inside it: the detailed coast */
      const bx = [MX + pr.x(COAST.box[0]), Hp - MY - pr.y(COAST.box[3]), MX + pr.x(COAST.box[2]), Hp - MY - pr.y(COAST.box[1])];
      cs.push(`q ${f(MX)} ${f(Hp - MY - MH)} ${f(MW)} ${f(MH)} re ${f(bx[0])} ${f(bx[3])} ${f(bx[2] - bx[0])} ${f(bx[1] - bx[3])} re W* n ${rgbf([216,210,190])} rg`); poly(COAST.world); cs.push("Q");
      cs.push(`q ${f(bx[0])} ${f(bx[3])} ${f(bx[2] - bx[0])} ${f(bx[1] - bx[3])} re W n ${rgbf([216,210,190])} rg`); poly(COAST.detail); cs.push("Q");
    } else poly(COAST.world);
  }
  /* graticule, route, waypoints */
  const span = pr.bb[2] - pr.bb[0], step = span > 40 ? 10 : span > 16 ? 5 : span > 6 ? 2 : span > 2.5 ? 1 : 0.5;
  cs.push(`${rgbf([157,180,196])} RG .4 w`);
  for (let lo = Math.ceil(pr.bb[0]/step)*step; lo <= pr.bb[2]; lo += step){ const x = MX + pr.x(lo); cs.push(`${f(x)} ${f(Hp - MY)} m ${f(x)} ${f(Hp - MY - MH)} l S`); text(`${Math.abs(lo).toFixed(step < 1 ? 1 : 0)}°${lo < 0 ? "W" : "E"}`, x + 2, MY + MH - 3, 6, { color:[75,90,104] }); }
  for (let la = Math.ceil(pr.bb[1]/step)*step; la <= pr.bb[3]; la += step){ const y = MY + pr.y(la); cs.push(`${f(MX)} ${f(Hp - y)} m ${f(MX + MW)} ${f(Hp - y)} l S`); text(`${Math.abs(la).toFixed(step < 1 ? 1 : 0)}°${la < 0 ? "S" : "N"}`, MX + 2, y - 2, 6, { color:[75,90,104] }); }
  if (pts.length > 1){ cs.push(`${rgbf(TEAL)} RG 1.6 w ` + pts.map((p, i) => `${f(MX + pr.x(p.lon))} ${f(Hp - MY - pr.y(p.lat))} ${i ? "l" : "m"}`).join(" ") + " S"); }
  for (const r of ROWS.filter(r => !r.wp)){ const x = MX + pr.x(r.lon), y = Hp - MY - pr.y(r.lat); cs.push(`${rgbf(TEAL)} rg ${f(x - 1.6)} ${f(y - 1.6)} 3.2 3.2 re f`); }
  for (const p of pts){ const x = MX + pr.x(p.lon), y = MY + pr.y(p.lat), k = 0.5523*6;
    cs.push(`${rgbf(TEAL)} rg 1 1 1 RG 1 w ${f(x + 6)} ${f(Hp - y)} m ${f(x + 6)} ${f(Hp - y + k)} ${f(x + k)} ${f(Hp - y + 6)} ${f(x)} ${f(Hp - y + 6)} c ${f(x - k)} ${f(Hp - y + 6)} ${f(x - 6)} ${f(Hp - y + k)} ${f(x - 6)} ${f(Hp - y)} c ${f(x - 6)} ${f(Hp - y - k)} ${f(x - k)} ${f(Hp - y - 6)} ${f(x)} ${f(Hp - y - 6)} c ${f(x + k)} ${f(Hp - y - 6)} ${f(x + 6)} ${f(Hp - y - k)} ${f(x + 6)} ${f(Hp - y)} c b`);
    text(p.n || "", x, y + 2.6, 6.5, { bold:true, color:[255,255,255], align:"c" }); if (p.name) text(p.name, x + 9, y - 6, 7, { bold:true, color:[19,32,46] }); }
  cs.push("Q"); box(MX, MY, MW, MH, .6, [120,130,140]);
  /* summary and remarks */
  const SX = MX + MW + 14, SW = X1 - SX; let y = MY + 10;
  text("SUMMARY", SX, y, 9, { bold:true, color:NAVY }); y += 12;
  for (const ln of wrap(summaryText(), SW, 8.6)){ if (y > MY + MH - 30) break; text(ln, SX, y, 8.6); y += 11; }
  if (M.remarks){ y += 6; text("REMARKS", SX, y, 9, { bold:true, color:NAVY }); y += 12; for (const ln of wrap(M.remarks, SW, 8.6)){ if (y > MY + MH) break; text(ln, SX, y, 8.6); y += 11; } }
  /* table */
  const cols = COLS(), lead = M.mode === "route" ? [["where", "Where", 86], ["time", "Time", 54]] : [["time", "Time", 60]];
  const avail = X1 - X0 - lead.reduce((s, c) => s + c[2], 0), base = { wx:62, pop:24, tst:28, vis:22 }, tot = cols.reduce((s, [k]) => s + (base[k] || 22), 0), sc = avail/tot;
  const cw = cols.map(([k]) => (base[k] || 22)*sc);
  let ty = MY + MH + 12;
  const tableHead = () => {
    let x = X0 + lead.reduce((s, c) => s + c[2], 0); const groups = []; cols.forEach(([, , g], i) => { const q = groups[groups.length - 1]; if (q && q.g === g) { q.w += cw[i]; } else groups.push({ g, w:cw[i] }); });
    rect(X0, ty, X1 - X0, 12, [230,236,239]); for (const g of groups){ text(g.g, x + g.w/2, ty + 8.6, 6.6, { bold:true, align:"c", max:g.w - 2 }); box(x, ty, g.w, 12, .3, [180,190,196]); x += g.w; } ty += 12;
    x = X0; rect(X0, ty, X1 - X0, 13, [243,246,247]);
    for (const [, l, w] of lead){ text(l, x + 3, ty + 9, 6.8, { bold:true }); box(x, ty, w, 13, .3, [180,190,196]); x += w; }
    cols.forEach(([, l], i) => { text(l, x + cw[i]/2, ty + 9, 6.4, { bold:true, align:"c", max:cw[i] - 2 }); box(x, ty, cw[i], 13, .3, [180,190,196]); x += cw[i]; }); ty += 13;
  };
  tableHead();
  const HCOL = { 1:[252,239,201], 2:[247,207,154], 3:[238,154,134] };
  ROWS.forEach((r, ri) => {
    if (ty > Hp - 40){ flush(); header(true); ty = 80; tableHead(); }
    const c = CALC[ri] || { o:{}, p:{} }; let x = X0; const rh = 12.5;
    for (const [k, , w] of lead){ const t = k === "time" ? tLabel(r.t) : (r.wp ? `${r.n ? r.n + " " : ""}${r.name}` : r.name); text(t, x + 3, ty + 8.8, 6.8, { bold: r.wp, it: !r.wp, max:w - 5 }); box(x, ty, w, rh, .3, [200,208,213]); x += w; }
    cols.forEach(([k], i) => {
      let t = "", fill = null;
      if (k === "wx") t = wxWords(c);
      else if (/^[ws]\d/.test(k)){ const v = c.p[k]; t = v == null ? "" : String(v); if (v) { const a = Math.min(.55, v/100*.55); fill = [255 - (255 - 11)*a, 255 - (255 - 110)*a, 255 - (255 - 121)*a]; } }
      else { t = cellText(c, k); const L = k === "ws" ? lvl(c.o.ws, M.thr.wind) : k === "wvh" ? lvl(c.o.wvh, M.thr.seas) : 0; if (L) fill = HCOL[L]; }
      if (fill) rect(x, ty, cw[i], rh, fill);
      text(t, x + cw[i]/2, ty + 8.8, k === "wx" ? 6 : 7, { align:"c", max:cw[i] - 2, it: !r.wp });
      box(x, ty, cw[i], rh, .3, [200,208,213]); x += cw[i];
    });
    ty += rh;
  });
  /* NWS zones and notes */
  const zones = M.zonesInProduct !== false ? Object.values(G.cwf) : [];
  const ensure = need => { if (ty + need > Hp - 30){ flush(); header(true); ty = 84; } };
  ty += 12;
  if (zones.length){
    ensure(30); text("NWS MARINE FORECASTS", X0, ty, 9, { bold:true, color:NAVY }); ty += 13;
    for (const z of zones){
      ensure(24); text(`${z.id}  ${z.name}`, X0, ty, 8, { bold:true, max:X1 - X0 }); ty += 11;
      for (const p of z.periods.slice(0, 3)){ const ls = wrap(`${p.name}: ${p.text}`, X1 - X0 - 12, 7.6); ensure(ls.length*9.5 + 2); ls.forEach(l => { text(l, X0 + 10, ty, 7.6); ty += 9.5; }); }
      ty += 4;
    }
  }
  const nl = wrap(notesText(), X1 - X0, 7); ensure(nl.length*9 + 4); nl.forEach(l => { text(l, X0, ty, 7, { color:[90,104,116] }); ty += 9; });
  flush();
  /* page numbers */
  const n = pages.length; pages.forEach((p, i) => { cs = []; text(`Page ${i + 1} of ${n}`, X1, Hp - 12, 7, { align:"r", color:[110,120,130] }); pages[i] = p + "\n" + cs.join("\n"); });
  return pdfAssemble(pages, logo, W, Hp);
}

/* ---------- demo data ---------- */
function demoSource(s, locs){
  const off = { nws:0, nbm:0.5, gfs:1.5, ifs:-1, icon:0.8, gem:-1.8, ukmo:1, ww3:0, ecwam:0.3, mfwam:-0.25, gwam:0.45, nbmw:0.15 }[s.id] || 0;
  const now = Date.now();
  const res = locs.map(l => {
    const fx = clamp((l.lon + 80.6)/3, 0, 1.4), coast = Math.exp(-Math.max(0, l.lon + 80.6)/0.4);
    if (s.kind === "ens"){
      const n = s.id === "gefs" ? 31 : 51, mem = [];
      for (let m = 0; m < n; m++){ const a = arr(), e = Math.sin(m*1.7)*3 + (m % 7 - 3)*0.7;
        for (let i = 0; i < TL.n; i++){ const t = TL.t0 + i*H, d = (t - now)/(24*H); a[i] = Math.max(2, 12 + 6*fx + 7/(1 + Math.exp(-(d - 1.6)*3)) - 6/(1 + Math.exp(-(d - 4)*2)) + e*(0.5 + Math.max(0, d)*0.25)); }
        mem.push(a); }
      return mem;
    }
    if (s.kind === "nws" && l.lon > -78.6) return null;
    if (s.kind === "nbmw" && l.lon > -79.5) return null;
    const o = emptyRec([...ATM, ...WAVEF]);
    for (let i = 0; i < TL.n; i++){
      const t = TL.t0 + i*H, d = (t - now)/(24*H), hr = lp(t).h;
      const ws = Math.max(3, 12 + 6*fx + 7/(1 + Math.exp(-(d - 1.6)*3)) - 6/(1 + Math.exp(-(d - 4)*2)) + off);
      if (s.kind === "om" || s.kind === "nws"){
        o.ws[i] = ws; o.wg[i] = ws*1.35 + 1; o.wd[i] = (60 + 25*Math.tanh(d - 2) + off*4 + 360) % 360; o.t[i] = 74 + 4*Math.sin((hr - 9)/24*2*Math.PI)*coast + 2 - fx;
        const conv = (hr >= 13 && hr <= 19 ? 1 : 0.15)*(0.3 + coast*0.7)*(d < 2 ? 1 : 0.3);
        o.pop[i] = Math.round(clamp(conv*55 + off*3 + (d > 1.5 && d < 2.3 ? 35 : 0), 0, 100)); o.tst[i] = Math.round(clamp(conv*35 + off*2, 0, 100)); o.vis[i] = o.pop[i] > 50 ? 4 : 10;
      }
      if (s.kind === "wave" || s.kind === "nws" || s.kind === "nbmw"){
        const sw = 1.6 + 2.6/(1 + Math.exp(-(d - 2)*2.5)) - 1.8/(1 + Math.exp(-(d - 4.5)*2)), ww = 0.6 + ws*0.12 + off*0.4;
        o.swh[i] = Math.max(0.5, (sw + off*0.3)*(0.6 + 0.4*Math.min(1, fx + 0.3))); o.wwh[i] = Math.max(0.3, ww*(0.55 + 0.45*Math.min(1, fx + 0.2)));
        o.wvh[i] = Math.hypot(o.swh[i], o.wwh[i]); o.wvp[i] = 6 + 3/(1 + Math.exp(-(d - 2)*2.5)); o.swp[i] = o.wvp[i] + 2.5; o.wvd[i] = (70 + 15*Math.sin(d)) % 360; o.swd[i] = 75; o.sst[i] = 77 + fx*1.5 + off*0.2;
        if (s.kind === "nbmw"){ WAVEF.forEach(k => { if (k !== "wvh") o[k] = arr(); }); }
      }
    }
    return o;
  });
  if (s.kind === "wave") res.model = s.models[0];
  return new Promise(r => setTimeout(() => r(res), 150 + Math.random()*300));
}
function demoCWF(r){
  const off = r.lon > -79.8;
  return off ? { id:"AMZ575", name:"Volusia-Brevard County Line to Sebastian Inlet 20-60 nm", updated: new Date(Date.now() - 2*H).toISOString(), periods:[
      { name:"This Afternoon", text:"Northeast winds 15 to 20 knots. Seas 4 to 5 feet. Wave detail: east 5 feet at 7 seconds. Scattered showers and isolated thunderstorms." },
      { name:"Tonight", text:"Northeast winds 15 to 20 knots. Seas 4 to 6 feet. Wave detail: east 5 feet at 8 seconds. Scattered showers." },
      { name:"Friday", text:"Northeast winds 20 to 25 knots. Seas 6 to 8 feet. Wave detail: northeast 7 feet at 9 seconds. Showers likely." },
      { name:"Friday Night", text:"Northeast winds 20 to 25 knots. Seas 7 to 9 feet. Wave detail: northeast 8 feet at 10 seconds." }] }
    : { id:"AMZ555", name:"Sebastian Inlet to Jupiter Inlet 0-20 nm", updated: new Date(Date.now() - 2*H).toISOString(), periods:[
      { name:"This Afternoon", text:"East winds 10 to 15 knots. Seas 2 to 3 feet. Wave detail: east 3 feet at 6 seconds. Intracoastal waters a light chop. Scattered showers and isolated thunderstorms." },
      { name:"Tonight", text:"Northeast winds 10 to 15 knots. Seas 3 to 4 feet. Wave detail: east 4 feet at 7 seconds." },
      { name:"Friday", text:"Northeast winds 15 to 20 knots. Seas 4 to 6 feet. Wave detail: northeast 5 feet at 8 seconds. Intracoastal waters choppy." }] };
}
function demoRoute(){
  const t = Math.ceil(Date.now()/H)*H + 2*H;
  M.mode = "route"; M.title = M.title || "Demo route"; M.fc = M.fc || "";
  M.route = { pts:[
    { id:uid(), name:"Port Canaveral", lat:28.408, lon:-80.605, stay:0 },
    { id:uid(), name:"Sea buoy", lat:28.385, lon:-80.47, stay:0 },
    { id:uid(), name:"Offshore 1", lat:28.55, lon:-79.6, stay:4 },
    { id:uid(), name:"Offshore 2", lat:28.75, lon:-78.4, stay:0 }], depart:t, speed:9, auto:true, legH:3 };
  M.view = { lat:28.55, lon:-79.5, k:300 };
}

/* ---------- binding ---------- */
function bind(){
  $("modeSel").onclick = ev => { const b = ev.target.closest("button[data-m]"); if (!b) return; M.mode = b.dataset.m; M.disc = null; if (M.mode === "point" && !M.point.start){ M.point.start = Math.ceil(Date.now()/H)*H; M.point.end = M.point.start + 72*H; } changed(); fitMap(); };
  $("tzSel").onclick = ev => { const b = ev.target.closest("button[data-z]"); if (!b) return; M.zulu = b.dataset.z === "z"; save(); renderAll(); };
  $("mTitle").onchange = ev => { M.title = ev.target.value.trim(); save(); renderAll(); };
  $("mFc").onchange = ev => { M.fc = ev.target.value.trim().toUpperCase(); save(); renderAll(); };
  $("reload").onclick = () => loadAll();
  $("tbl").addEventListener("click", ev => { const td = ev.target.closest("td.ed"); if (td && !td.querySelector("input")) startEdit(td); });
  $("tbl").addEventListener("keydown", ev => { const td = ev.target.closest && ev.target.closest("td.ed"); if (td && ev.target === td && (ev.key === "Enter" || /^[0-9A-Za-z.]$/.test(ev.key))){ ev.preventDefault(); startEdit(td); if (ev.key.length === 1){ const i = td.querySelector("input"); if (i) i.value = ev.key; } } });
  $("clrEd").onclick = () => { if (!Object.keys(M.edits).length) return toast("No edits to clear"); if (!confirm("Clear every change you made to the forecast?")) return; M.edits = {}; save(); renderAll(); };
  $("disc").oninput = ev => { M.disc = { text: ev.target.value }; save(); $("discNote").textContent = "Your wording (automatic text no longer updates)"; };
  $("discReset").onclick = () => { M.disc = null; save(); renderSummary(); };
  $("remarks").oninput = ev => { M.remarks = ev.target.value; save(); };
  $("zInc").onchange = ev => { M.zonesInProduct = ev.target.checked; save(); };
  const thr = (id, key, lo, hi) => { $(id).onchange = ev => { const v = ev.target.value.split(/[ ,;]+/).map(Number).filter(x => x >= lo && x <= hi); M.thr[key] = v.length ? [...new Set(v)].sort((a, b) => a - b).slice(0, 3) : DEF.thr[key].slice(); while (M.thr[key].length < 3) M.thr[key].push(M.thr[key][M.thr[key].length - 1] + (key === "wind" ? 5 : 2)); save(); renderThr(); renderAll(); }; };
  thr("thrWind", "wind", 1, 100); thr("thrSeas", "seas", 1, 60);
  const pct = () => { let a = Math.round(+$("pctLo").value), b = Math.round(+$("pctHi").value); if (!(a >= 0 && a <= 49)) a = 25; if (!(b >= 51 && b <= 100)) b = 75; M.pct = [a, b]; save(); renderThr(); renderAll(); };
  $("pctLo").onchange = pct; $("pctHi").onchange = pct;
  $("srcGrid").addEventListener("change", ev => {
    const c = ev.target.dataset.src, w = ev.target.dataset.w;
    if (c){ M.src[c] = { ...(M.src[c] || {}), on: ev.target.checked }; }
    if (w){ const v = +ev.target.value; M.src[w] = { ...(M.src[w] || {}), w: isFinite(v) && v >= 0 ? v : undefined }; }
    save(); renderAll();
  });
  $("srcReset").onclick = () => { M.src = {}; save(); renderAll(); };
  $("txtBtn").onclick = async () => { if (needData()) return; const t = textProduct(); try { await navigator.clipboard.writeText(t); toast("Text forecast copied"); } catch (e) { download(new Blob([t], { type:"text/plain" }), fname() + ".txt"); } };
  $("csvBtn").onclick = () => { if (needData()) return; download(new Blob([csvProduct()], { type:"text/csv" }), fname() + ".csv"); };
  $("htmlBtn").onclick = async () => { if (needData()) return; if (!LOGO_DATA) await loadLogoData(); download(new Blob([htmlProduct()], { type:"text/html" }), fname() + ".html"); };
  $("pdfBtn").onclick = async () => { if (needData()) return; try { download(await pdfProduct(), fname() + ".pdf"); } catch (e) { console.error(e); toast("Couldn't build the PDF: " + e.message); } };
  window.addEventListener("resize", () => { clearTimeout(window._mr); window._mr = setTimeout(renderMap, 150); });
  bindMap(); bindRoute();
}
function renderThr(){
  const v = (id, val) => { const e = $(id); if (e && document.activeElement !== e) e.value = val; };
  v("thrWind", M.thr.wind.join(", ")); v("thrSeas", M.thr.seas.join(", ")); v("pctLo", M.pct[0]); v("pctHi", M.pct[1]);
}

/* ---------- start ---------- */
(function start(){
  if (DEMO && !M.route.pts.length && M.mode === "route") demoRoute();
  if (!M.route.depart) M.route.depart = Math.ceil(Date.now()/H)*H + H;
  bind(); renderThr(); renderAll(); loadCoast(); loadAll();
})();
