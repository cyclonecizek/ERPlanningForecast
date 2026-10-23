"use strict";
/* ============================================================
   Launch Mission Execution Forecast (LMEF)
   First guess from the guidance blend at the pad for the primary
   and 24-hour delay windows; every field can be edited.
   ============================================================ */
const PADS = [
  { id:"lc39a", name:"LC-39A", full:"Launch Complex 39A", lat:28.6083, lon:-80.6041, stn:"KTTS", match:/39A/i },
  { id:"lc39b", name:"LC-39B", full:"Launch Complex 39B", lat:28.6272, lon:-80.6208, stn:"KTTS", match:/39B/i },
  { id:"slc40", name:"SLC-40", full:"Space Launch Complex 40", lat:28.5620, lon:-80.5772, stn:"KXMR", match:/\b40\b/ },
  { id:"slc41", name:"SLC-41", full:"Space Launch Complex 41", lat:28.5833, lon:-80.5830, stn:"KXMR", match:/\b41\b/ },
  { id:"slc37", name:"SLC-37", full:"Space Launch Complex 37", lat:28.5314, lon:-80.5650, stn:"KXMR", match:/37/ },
  { id:"lc36",  name:"LC-36",  full:"Launch Complex 36",       lat:28.4710, lon:-80.5378, stn:"KXMR", match:/\b36\b/ },
  { id:"slc46", name:"SLC-46", full:"Space Launch Complex 46", lat:28.4585, lon:-80.5284, stn:"KXMR", match:/\b46\b/ },
];
const LMK = "lmef:v1";
const RISK = ["Low","Moderate","High"];
const CONCERNS = ["Cumulus Cloud Rule","Lightning Rule","Anvil Cloud Rule","Attached Anvil Rule","Thick Cloud Layers Rule","Disturbed Weather Rule","Flight Through Precipitation","Surface Electric Fields","Liftoff Winds","Ground Winds","Upper-Level Winds","None"];
const VEHICLE_LIMITS = { "Falcon 9":30, "Falcon Heavy":30, "Vulcan":33, "Atlas V":33, "New Glenn":30, "SLS":34, "Starship":30 };
/* additional risk criteria: three built in (each can be switched off) plus any the forecaster adds */
const BUILTIN_RISKS = [
  { id:"shear",    name:"Upper-Level Wind Shear",   auto:"GFS 300-200 hPa winds" },
  { id:"recovery", name:"Booster Recovery Weather", auto:"recovery site winds and seas" },
  { id:"proton",   name:"Proton Flux",              auto:"GOES ≥10 MeV protons and the SWPC 3-day forecast" },
];
const LS2 = {
  get(d){ try { const v = localStorage.getItem(LMK); return v ? JSON.parse(v) : d; } catch (e){ return d; } },
  set(v){ try { localStorage.setItem(LMK, JSON.stringify(v)); } catch (e){ /* storage unavailable */ } },
};
const L = Object.assign({ mission:"", vehicle:"Falcon 9", pad:"slc40", windows:null, discussion:"", next:"As Required", days:[], missionId:"",
  liftoff:{ h:200, kind:"peak", op:">", v:30, unit:"kt" }, ftp:false, risks:null, recovery:[] }, LS2.get({}));
/* older saves: one launch window plus one delay */
if (!L.windows){
  const w0 = L.w0, w1 = L.w1;
  L.windows = w0 ? [{ a:w0, b:w1 }, { a:L.d0 || w0 + 24*H, b:L.d1 || w1 + 24*H }] : null;
  if (L.days && !Array.isArray(L.days)) L.days = [L.days.day, L.days.delay].filter(Boolean);
  if (L.limit) L.liftoff.v = L.limit;
}
if (!Array.isArray(L.days)) L.days = [];
if (!L.risks) L.risks = BUILTIN_RISKS.map(r => ({ id:r.id, name:r.name, on:true, builtin:true }));
L.risks.forEach(r => { if (r.id === "solar"){ r.id = "proton"; r.name = "Proton Flux"; } });
const saveL = () => LS2.set(L);
const SX = { launches:[], G:null, TL:null, status:{}, loading:false, upper:null, proton:null, recov:{}, guide:[], tok:0 };
const winLabel = i => i === 0 ? "Launch day" : `${i*24}-hour delay`;
const liftoffKt = () => (+L.liftoff.v || 0)*(WIND_UNITS[L.liftoff.unit] || 1);
const liftoffKey = () => (L.liftoff.kind === "sust" ? "s" : "g") + (Math.round(+L.liftoff.h) || 200);
/* ---------- time formatting ---------- */
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const lpad = n => String(n).padStart(2, "0");
const lDate = ms => { const p = lp(ms); return `${p.d} ${MON[p.mo - 1]} ${p.y}`; };
const lHM = ms => { const p = lp(ms); return `${lpad(p.h)}${lpad(p.mi)}`; };
const zHM = ms => { const d = new Date(ms); return `${lpad(d.getUTCHours())}${lpad(d.getUTCMinutes())}`; };
const winText = (a, b) => a && b ? `${lDate(a)} / ${lHM(a)} – ${lHM(b)}L (${zHM(a)} – ${zHM(b)}Z)` : "–";
const issuedText = ms => `${lDate(ms)} / ${lHM(ms)}L (${zHM(ms)}Z)`;
function toInput(ms){ if (!ms) return ""; const p = lp(ms); return `${p.y}-${lpad(p.mo)}-${lpad(p.d)}T${lpad(p.h)}:${lpad(p.mi)}`; }
function fromInput(v){
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); if (!m) return null;
  const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  for (const off of [4, 5]){ const t = base + off*H, p = lp(t); if (p.h === +m[4] && p.d === +m[3] && p.mi === +m[5]) return t; }
  return base + 5*H;
}

/* ---------- upcoming launches (Launch Library 2, mirrored by the workflow) ---------- */
async function fetchLaunches(){
  let j = null;
  try { j = await getJSON(`data/launches.json?ts=${Date.now()}`, 8000); } catch (e) { j = null; }
  if (!j || !j.results){
    const c = (() => { try { return JSON.parse(localStorage.getItem("lmef:ll2") || "null"); } catch (e) { return null; } })();
    if (c && Date.now() - c.t < 3600e3) j = c.j;
    else {
      try { j = await getJSON("https://ll.thespacedevs.com/2.2.0/launch/upcoming/?location__ids=12,27&limit=15", 15000); try { localStorage.setItem("lmef:ll2", JSON.stringify({ t:Date.now(), j })); } catch (e) {} }
      catch (e) { j = c ? c.j : null; }
    }
  }
  const res = (j && j.results) || [];
  return res.map(r => {
    const nm = String(r.name || ""), parts = nm.split(" | ");
    const padName = (r.pad && (r.pad.name || "")) || "";
    const pad = PADS.find(p => p.match.test(padName));
    return {
      id: r.id || nm, name: parts[1] || nm, vehicle: (r.rocket && r.rocket.configuration && (r.rocket.configuration.name || r.rocket.configuration.full_name)) || parts[0] || "",
      pad: pad ? pad.id : null, padName, net: Date.parse(r.net), w0: Date.parse(r.window_start || r.net), w1: Date.parse(r.window_end || r.net),
      status: r.status && (r.status.abbrev || r.status.name) || "",
    };
  }).filter(x => isFinite(x.net)).sort((a, b) => a.net - b.net);
}

/* ---------- guidance at the pad ---------- */
async function loadGuidance(){
  const tok = ++SX.tok;
  const pad = PADS.find(p => p.id === L.pad) || PADS[2];
  SITES.splice(0, SITES.length, { id:pad.id, name:pad.name, point:pad.name, stn:pad.stn, lat:pad.lat, lon:pad.lon });
  setHeights();
  SX.TL = makeTimeline(Date.now()); SX.G = new SiteGuidance(SITES[0], SX.TL, []); SX.status = {}; SX.loading = true;
  lmRenderStatus();
  const jobs = [];
  const om = (d, ens) => (DEMO ? demoOM(d, ens, SX.TL) : fetchOM(d, ens, SX.TL)).then(per => { if (tok !== SX.tok) return; const ms = per[0] || []; if (ms.length){ SX.G.addSource(d, ms); SX.status[d.id] = 1; } }).catch(() => {}).finally(sched);
  OM_DET.forEach(d => jobs.push(om(d, false))); OM_ENS.forEach(d => jobs.push(om(d, true)));
  MOS.forEach(d => jobs.push((DEMO ? demoMOS(d, SX.TL) : fetchMOS(d, SX.TL)).then(per => { if (tok !== SX.tok) return; const x = per[pad.stn]; if (x && x.members[0].t.some(v => v != null)){ SX.G.addSource(d, x.members, { iv:x.iv, run:x.run }); SX.status[d.id] = 1; } }).catch(() => {}).finally(sched)));
  jobs.push((DEMO ? demoPipeline(SX.TL) : fetchPipeline(SX.TL)).then(res => { if (tok !== SX.tok) return; for (const d of PIPE){ const x = res[d.id], p = x && x.per[pad.id]; if (p){ SX.G.addSource(d, p.members, p.iv ? { iv:p.iv, run:x.run } : null); SX.status[d.id] = 1; } } }).catch(() => {}).finally(sched));
  jobs.push(fetchUpper(pad).then(u => { if (tok === SX.tok) SX.upper = u; }).catch(() => {}).finally(sched));
  jobs.push(fetchProton().then(k => { if (tok === SX.tok) SX.proton = k; }).catch(() => {}).finally(sched));
  jobs.push(loadRecovery());
  await Promise.allSettled(jobs);
  if (tok !== SX.tok) return;
  SX.loading = false; sched();
}
/* the liftoff constraint height gets its own sustained / peak winds */
function setHeights(){
  const h = Math.round(+L.liftoff.h) || 200;
  HEIGHTS.splice(0, HEIGHTS.length, ...[...new Set([54, 200, h])].sort((a, b) => a - b));
  if (SX.G) for (const s of SX.G.src) for (const m of s.members) deriveHeights(m, SX.TL.n);
}
let schedT = null;
function sched(){ if (schedT) return; schedT = setTimeout(() => { schedT = null; analyzeAll(); lmRenderAll(); }, 250); }
/* upper-level winds from GFS (max speed 300-200 hPa, kt) */
async function fetchUpper(pad){
  if (DEMO) return { t:[], max:[] };
  const lv = [300, 250, 200];
  const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${pad.lat}&longitude=${pad.lon}&hourly=${lv.map(l => `wind_speed_${l}hPa`).join(",")}&models=gfs_seamless&wind_speed_unit=kn&timeformat=unixtime&timezone=GMT&forecast_days=8`, 30000);
  const hr = j.hourly || {}, t = (hr.time || []).map(x => x*1000);
  return { t, max: t.map((_, i) => Math.max(...lv.map(l => (hr[`wind_speed_${l}hPa`] || [])[i] ?? 0))) };
}
/* proton flux: current GOES >=10 MeV integral flux, plus the SWPC 3-day S1-or-greater probabilities */
async function fetchProton(){
  if (DEMO) return { now: 0.4, days: [{ d: Date.now(), p: 1 }, { d: Date.now() + 86400e3, p: 1 }, { d: Date.now() + 2*86400e3, p: 1 }] };
  const out = { now:null, days:[] };
  try {
    let j = null; try { j = await getJSON(`data/protons.json?ts=${Date.now()}`, 8000); } catch (e) { j = null; }
    if (!j) j = await getJSON("https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json", 15000);
    const ten = (Array.isArray(j) ? j : []).filter(r => /10 MeV/.test(r.energy || "") && r.flux != null);
    if (ten.length) out.now = +ten[ten.length - 1].flux;
  } catch (e) { /* unavailable */ }
  try {
    let t = null; try { const r = await fetch(`data/3day.txt?ts=${Date.now()}`, { cache:"no-store" }); if (r.ok) t = await r.text(); } catch (e) { t = null; }
    if (!t){ const r = await fetch("https://services.swpc.noaa.gov/text/3-day-forecast.txt", { cache:"no-store" }); if (r.ok) t = await r.text(); }
    if (t){
      const blk = t.split(/Solar Radiation Activity Forecast/i)[1] || "";
      const hdr = blk.match(/\n\s*((?:[A-Z][a-z]{2} \d{2}\s+){3})/); const row = blk.match(/S1 or greater\s+(\d+)%\s+(\d+)%\s+(\d+)%/);
      const yr = new Date().getUTCFullYear();
      if (hdr && row){ const ds = hdr[1].trim().split(/\s{2,}/); ds.forEach((d, i) => { const ms = Date.parse(`${d} ${yr} 00:00 UTC`); if (isFinite(ms)) out.days.push({ d: ms, p: +row[i + 1] }); }); }
    }
  } catch (e) { /* unavailable */ }
  return out;
}
/* recovery sites: winds from the forecast API, seas from the marine API */
async function loadRecovery(){
  SX.recov = {};
  for (const r of L.recovery || []){
    if (!isFinite(+r.lat) || !isFinite(+r.lon)) continue;
    try {
      if (DEMO){ SX.recov[r.id] = demoRecov(); continue; }
      const [w, m] = await Promise.all([
        getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${r.lat}&longitude=${r.lon}&hourly=wind_speed_10m,wind_gusts_10m&wind_speed_unit=kn&timeformat=unixtime&timezone=GMT&forecast_days=8`, 25000),
        getJSON(`https://marine-api.open-meteo.com/v1/marine?latitude=${r.lat}&longitude=${r.lon}&hourly=wave_height&timeformat=unixtime&timezone=GMT&forecast_days=8`, 25000).catch(() => null),
      ]);
      const t = ((w.hourly || {}).time || []).map(x => x*1000);
      const wt = m && m.hourly ? (m.hourly.time || []).map(x => x*1000) : [];
      SX.recov[r.id] = { t, wind:(w.hourly || {}).wind_speed_10m || [], gust:(w.hourly || {}).wind_gusts_10m || [], wt, wave: m && m.hourly ? m.hourly.wave_height || [] : [] };
    } catch (e) { SX.recov[r.id] = { err:true }; }
  }
  sched();
}
function demoRecov(){ const t0 = Math.floor(Date.now()/H)*H, t = [], wind = [], gust = [], wave = []; for (let i = 0; i < 190; i++){ t.push(t0 + i*H); wind.push(12 + 6*Math.sin(i/14)); gust.push(17 + 7*Math.sin(i/14)); wave.push(1.4 + 0.6*Math.sin(i/20)); } return { t, wind, gust, wt:t, wave }; }
function recoveryEval(A, B){
  const res = [];
  for (const r of L.recovery || []){
    const d = SX.recov[r.id]; if (!d || d.err) continue;
    const inW = (ts, arr) => ts.map((x, i) => x >= Math.floor(A/H)*H && x <= Math.ceil(B/H)*H ? arr[i] : null).filter(v => v != null);
    const g = inW(d.t, d.gust.length ? d.gust : d.wind), wv = inW(d.wt, d.wave).map(m => m*3.28084);
    const gmax = g.length ? Math.max(...g) : null, wmax = wv.length ? Math.max(...wv) : null;
    const wl = +r.windKt || null, hl = +r.waveFt || null;
    const ratio = Math.max(wl && gmax != null ? gmax/wl : 0, hl && wmax != null ? wmax/hl : 0);
    res.push({ name:r.name || "Recovery site", gmax, wmax, lv: ratio >= 1 ? 2 : ratio >= 0.8 ? 1 : 0 });
  }
  return res;
}

/* ---------- first guess for one window ---------- */
const median = a => { a = a.filter(v => v != null && isFinite(v)).sort((x, y) => x - y); if (!a.length) return null; const k = a.length >> 1; return a.length % 2 ? a[k] : (a[k - 1] + a[k])/2; };
const KT2MPH = 1.150779;
function analyzeWindow(A, B){
  const G = SX.G, TL = SX.TL; if (!G || !A || !B || B <= A) return null;
  const i0 = TL.idx(Math.floor(A/H)*H), i1 = TL.idx(Math.ceil(B/H)*H);
  if (i0 < 0 || i1 >= TL.n) return { outOfRange:true };
  const mid = TL.idx(Math.round((A + B)/2/H)*H);
  const srcs = G.src.filter(s => s.members.length || s.iv);
  const memW = []; srcs.forEach(s => s.members.forEach(m => memW.push([m, 1/Math.max(1, s.members.length), s])));
  const frac = f => { let w = 0, h = 0; for (const [m, wt] of memW){ const v = f(m); if (v == null) continue; w += wt; if (v) h += wt; } return w ? h/w : null; };
  const maxIn = (m, k) => { let mx = null; for (let i = i0; i <= i1; i++){ const v = m[k] && m[k][i]; if (v != null && (mx == null || v > mx)) mx = v; } return mx; };
  const minIn = (m, k) => { let mn = null; for (let i = i0; i <= i1; i++){ const v = m[k] && m[k][i]; if (v != null && (mn == null || v < mn)) mn = v; } return mn; };
  const winAvg = ev => { const a = Math.floor(A/H)*H, b = Math.ceil(B/H)*H; const ps = srcs.map(s => G.srcWin(s, ev, a, b)).filter(v => v != null); return ps.length ? ps.reduce((x, y) => x + y, 0)/ps.length : null; };
  /* constraint parts for any stretch of the window */
  const partsFor = (a, b) => {
    const j0 = TL.idx(Math.floor(a/H)*H), j1 = TL.idx(Math.ceil(b/H)*H);
    const mx = (m, k) => { let v = null; for (let i = j0; i <= j1; i++){ const x = m[k] && m[k][i]; if (x != null && (v == null || x > v)) v = x; } return v; };
    const avg = ev => { const ps = srcs.map(s => G.srcWin(s, ev, Math.floor(a/H)*H, Math.ceil(b/H)*H)).filter(v => v != null); return ps.length ? ps.reduce((x, y) => x + y, 0)/ps.length : null; };
    const pLtg = avg("tst") ?? 0, pPop = avg("pop") ?? 0;
    const lim = liftoffKt(), lk = liftoffKey(), gt = L.liftoff.op === ">=";
    const pWind = frac(m => { const g = mx(m, lk); return g == null ? null : (gt ? g >= lim : g > lim); }) ?? 0;
    const pThick = frac(m => { const c = mx(m, "cm"); return c == null ? null : c >= 75; }) ?? 0;
    const pLowCu = frac(m => { const c = mx(m, "cl"); return c == null ? null : c >= 50; }) ?? 0;
    const pCu = Math.min(0.95, 0.6*pPop + 0.25*pLowCu);
    const parts = [["Cumulus Cloud Rule", pCu], ["Lightning Rule", pLtg*0.8], ["Thick Cloud Layers Rule", pThick*0.5], ["Liftoff Winds", pWind]];
    if (pLtg >= 0.3) parts.push(["Anvil Cloud Rule", pLtg*0.4]);
    if (L.ftp) parts.push(["Flight Through Precipitation", pPop*0.9]);
    const pov = 1 - parts.reduce((q, [, p]) => q*(1 - Math.min(0.99, p)), 1);
    return { parts, pov, pLtg, pPop };
  };
  const r5 = p => Math.max(5, Math.min(95, Math.round(p*100/5)*5));
  /* long windows: PoV by segment; the headline is the chance at a random time, the segment average */
  const segs = [];
  const len = (B - A)/H;
  if (len >= 2){
    const step = len <= 12 ? 1 : len <= 24 ? 2 : 3;
    for (let a = A; a < B - 1e-6; a += step*H){ const b = Math.min(B, a + step*H); const q = partsFor(a, b); segs.push({ a, b, pov: r5(q.pov), raw:q.pov, parts:q.parts }); }
  }
  const whole = partsFor(A, B);
  const { pLtg, pPop } = whole;
  let parts = whole.parts, povR = r5(whole.pov);
  if (segs.length){
    const wsum = segs.reduce((x, g) => x + (g.b - g.a), 0);
    povR = r5(segs.reduce((x, g) => x + g.raw*(g.b - g.a), 0)/wsum);
    /* segments can carry different rules (an anvil only where storms are likely), so match them by name */
    const names = [...new Set([...whole.parts, ...segs.flatMap(g => g.parts)].map(p => p[0]))];
    parts = names.map(n => [n, segs.reduce((x, g) => { const q = g.parts.find(p => p[0] === n); return x + (q ? q[1] : 0)*(g.b - g.a); }, 0)/wsum]);
  }
  const concerns = parts.filter(x => x[1] >= 0.05).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
  const T = median(memW.map(([m]) => m.t && m.t[mid])), Td = median(memW.map(([m]) => m.td && m.td[mid]));
  const rh = T != null && Td != null ? Math.round(rhFrom(T, Td)) : null;
  const vis = median(memW.map(([m]) => minIn(m, "vis")));
  const visMi = vis == null ? 7 : Math.min(7, Math.max(0, Math.round(vis/1609.34)));
  const wx = pLtg >= 0.3 ? "Thunderstorms" : pPop >= 0.4 ? "Showers" : pPop >= 0.2 ? "Isolated showers" : "None";
  let U = 0, V = 0; memW.forEach(([m, wt]) => { const d = m.d10 && m.d10[mid], s = m.s200 && m.s200[mid]; if (d == null || s == null) return; U += -Math.sin(d*Math.PI/180)*s*wt; V += -Math.cos(d*Math.PI/180)*s*wt; });
  const dir = Math.round(((Math.atan2(-U, -V)*180/Math.PI + 360) % 360)/10)*10 || 360;
  const sLo = median(memW.map(([m]) => minIn(m, "s200"))), gHi = median(memW.map(([m]) => maxIn(m, "g200")));
  const lo = sLo == null ? null : Math.max(0, Math.floor(sLo*KT2MPH/5)*5), hi = gHi == null ? null : Math.max((lo ?? 0) + 5, Math.ceil(gHi*KT2MPH/5)*5);
  const cl = median(memW.map(([m]) => maxIn(m, "cl"))), cm = median(memW.map(([m]) => maxIn(m, "cm"))), ch = median(memW.map(([m]) => maxIn(m, "ch")));
  const lcb = median(memW.map(([m]) => minIn(m, "lcb")).filter(v => v != null && v < 12000));
  const cov = p => p == null || p < 6.25 ? null : p < 31.25 ? "Few" : p < 56.25 ? "Scattered" : p < 93.75 ? "Broken" : "Overcast";
  const r100 = v => Math.round(v/500)*500;
  const clouds = [];
  if (cov(cl)){ const base = r100(lcb != null ? Math.max(1000, lcb) : 4000); clouds.push({ type: cl >= 75 ? "Stratocumulus" : "Cumulus", cov: cov(cl), base, tops: r100(base + 4000 + 14000*Math.min(1, pPop + pLtg)) }); }
  if (cov(cm)) clouds.push({ type: cm >= 75 ? "Altostratus" : "Altocumulus", cov: cov(cm), base:12000, tops:16000 });
  if (cov(ch)) clouds.push({ type: ch >= 75 ? "Cirrostratus" : "Cirrus", cov: cov(ch), base:28000, tops:35000 });
  if (!clouds.length) clouds.push({ type:"None", cov:"", base:null, tops:null });
  /* additional risk criteria */
  const risk = {}, why = {};
  if (SX.upper && SX.upper.t.length){ const v = SX.upper.t.map((t, i) => t >= Math.floor(A/H)*H && t <= Math.ceil(B/H)*H ? SX.upper.max[i] : null).filter(x => x != null); const mx = v.length ? Math.max(...v) : 0; risk.shear = mx >= 140 ? 2 : mx >= 100 ? 1 : 0; why.shear = `jet up to ${Math.round(mx)} kt`; }
  if (SX.proton){
    const dayP = (SX.proton.days || []).filter(x => A < x.d + 86400e3 && B > x.d).map(x => x.p);
    const p = dayP.length ? Math.max(...dayP) : null, now = SX.proton.now, soon = A - Date.now() < 12*H;
    risk.proton = (soon && now != null && now >= 100) || (p != null && p >= 50) ? 2 : (soon && now != null && now >= 10) || (p != null && p >= 10) ? 1 : 0;
    why.proton = [now != null ? `${now < 1 ? now.toFixed(2) : Math.round(now)} pfu now` : "", p != null ? `S1+ ${p}%` : "beyond the 3-day forecast"].filter(Boolean).join(", ");
  }
  const rec = recoveryEval(A, B);
  if (rec.length){ risk.recovery = Math.max(...rec.map(r => r.lv)); why.recovery = rec.map(r => `${r.name}: gusts ${r.gmax == null ? "–" : Math.round(r.gmax) + " kt"}, seas ${r.wmax == null ? "–" : r.wmax.toFixed(1) + " ft"}`).join("; "); }
  return { segs: segs.map(g => ({ a:g.a, b:g.b, pov:g.pov })), pov:povR, concerns: concerns.length ? concerns : ["None"], wx, vis:visMi, t: T == null ? null : Math.round(T), rh, dir, lo, hi, clouds, risk, why,
    parts: parts.map(([n, p]) => [n, Math.round(p*100)]), pLtg, pPop };
}
function analyzeAll(){
  SX.guide = (L.windows || []).map(w => analyzeWindow(w.a, w.b));
  SX.guide.forEach((g, i) => { if (g && !g.outOfRange && !(L.days[i] && L.days[i].edited)) L.days[i] = fromGuide(g, L.days[i]); });
  if (!L.discussionEdited) L.discussion = draftDiscussion();
  saveL();
}
function fromGuide(g, old){
  const risk = {};
  for (const r of L.risks){ const v = g.risk[r.id]; risk[r.id] = v != null ? RISK[v] : (old && old.risk && old.risk[r.id]) || "Low"; }
  return { seg: g.segs.length ? g.segs : null, showSeg: old && old.showSeg === false ? false : true, pov:g.pov, concerns:g.concerns.join(", "), wx:g.wx, vis:`${g.vis} mi.`, temp: g.t == null ? "" : `${g.t}°F`, rh: g.rh == null ? "" : `${g.rh}%`,
    wind: g.lo == null ? "" : `${lpad3(g.dir)}° ${g.lo} - ${g.hi} mph`, clouds: g.clouds.map(c => ({ ...c })), risk, edited:false };
}
const lpad3 = n => String(n).padStart(3, "0");
function draftDiscussion(){
  const g = SX.guide[0]; if (!g || g.outOfRange) return "";
  const dirWord = deg => ["north","northeast","east","southeast","south","southwest","west","northwest"][Math.round(((deg % 360) + 360) % 360/45) % 8];
  const sky = g.clouds[0] && g.clouds[0].type !== "None" ? `${g.clouds[0].cov.toLowerCase()} ${g.clouds[0].type.toLowerCase()}` : "mostly clear skies";
  const wxs = g.wx === "None" ? "no precipitation expected during the window" : `${g.wx.toLowerCase()} possible during the window (${Math.round(g.pPop*100)}% precipitation, ${Math.round(g.pLtg*100)}% lightning)`;
  const conc = g.concerns[0] === "None" ? "Weather is not expected to be a concern for the primary window." : `The main concern for the primary window is the ${g.concerns.join(" and the ")}.`;
  let s = `Guidance shows ${sky} at the pad with ${wxs}. Liftoff winds at 200 ft are forecast from the ${dirWord(g.dir)} at ${g.lo}–${g.hi} mph. ${conc}`;
  SX.guide.slice(1).forEach((d, i) => { if (d && !d.outOfRange) s += ` For the ${winLabel(i + 1)}, the probability of violation is ${d.pov}%${d.concerns[0] !== "None" ? `, mainly for the ${d.concerns[0]}` : ""}.`; });
  return s + " [Add the synoptic setup and forecaster reasoning.]";
}

/* ---------- product (preview and HTML) ---------- */
/* PoV through a long window: one bar per segment, plus the best and worst periods */
const segOn = D => D && D.seg && D.seg.length > 1 && D.showSeg !== false;
function segSummary(D){
  const sg = D.seg, lo = Math.min(...sg.map(s => +s.pov)), hi = Math.max(...sg.map(s => +s.pov));
  /* the longest unbroken stretch at that value (ties go to the earliest) */
  const span = v => { let best = null, cur = null; sg.forEach(s => { if (+s.pov === v){ cur = cur ? { a:cur.a, b:s.b, n:cur.n + 1 } : { a:s.a, b:s.b, n:1 }; if (!best || cur.n > best.n) best = cur; } else cur = null; }); return `${lHM(best.a)}–${lHM(best.b)}L`; };
  return lo === hi ? `PoV is about the same through the window (${lo}%).` : `Best opportunity ${span(lo)} (${lo}%). Highest risk ${span(hi)} (${hi}%).`;
}
function segStrip(D){
  if (!segOn(D)) return "";
  const top = Math.max(50, ...D.seg.map(x => +x.pov));
  return `<div class="lm-seg"><h3>PoV through the window</h3><div class="lm-bars">${D.seg.map(s => { const [c] = POVC(+s.pov); return `<div class="b"><i style="height:${Math.max(5, 100*(+s.pov)/top)}%;background:${c}"></i><b>${s.pov}%</b><span>${lHM(s.a)}</span></div>`; }).join("")}</div><p>${segSummary(D)}</p></div>`;
}
const POVC = p => p >= 40 ? ["#B23A2E","High"] : p >= 20 ? ["#C98A1B","Moderate"] : ["#2F7A4A","Low"];
const RISKC = { Low:"#2F7A4A", Moderate:"#C98A1B", High:"#B23A2E" };
const risksOn = () => L.risks.filter(r => r.on && r.name);
function productHTML(logo){
  const pad = PADS.find(p => p.id === L.pad) || PADS[2], issued = L.issued || Date.now(), W0 = (L.windows || [])[0] || {};
  const day = (i, w) => {
    const D = L.days[i] || {}; const [pc, pl] = POVC(+D.pov || 0);
    const clouds = (D.clouds || []).filter(c => c.type);
    const rk = risksOn();
    return `<section class="lm-day">
      <div class="lm-dayhead"><h2>${winLabel(i)}</h2><span>${winText(w.a, w.b)}</span></div>
      <div class="lm-pov">
        <div class="lm-gauge" style="--p:${+D.pov || 0};--c:${pc}"><div><b>${D.pov ?? "–"}<small>%</small></b><span>Probability of violation<sup>1</sup></span></div></div>
        <div class="lm-conc"><h3>Primary concerns</h3><div class="lm-chips">${String(D.concerns || "None").split(/\s*,\s*/).filter(Boolean).map(c => `<span>${hesc(c)}</span>`).join("")}</div><p class="lm-lvl" style="color:${pc}">${pl} weather risk</p></div>
      </div>
      ${segStrip(D)}
      <div class="lm-grid ${rk.length ? "" : "two"}">
        <div class="lm-card"><h3>Weather conditions</h3>
          <dl><dt>Weather / visibility</dt><dd>${hesc(D.wx || "–")} / ${hesc(D.vis || "–")}</dd>
          <dt>Temperature / humidity</dt><dd>${hesc(D.temp || "–")} / ${hesc(D.rh || "–")}</dd>
          <dt>Liftoff winds (200 ft)</dt><dd>${hesc(D.wind || "–")}</dd></dl></div>
        <div class="lm-card"><h3>Clouds</h3>
          <table><thead><tr><th>Type</th><th>Coverage</th><th>Base (ft)</th><th>Tops (ft)</th></tr></thead><tbody>${clouds.length ? clouds.map(c => `<tr><td>${hesc(c.type)}</td><td>${hesc(c.cov || "")}</td><td>${c.base ? Number(c.base).toLocaleString("en-US") : "–"}</td><td>${c.tops ? Number(c.tops).toLocaleString("en-US") : "–"}</td></tr>`).join("") : `<tr><td colspan="4">None</td></tr>`}</tbody></table></div>
        ${rk.length ? `<div class="lm-card"><h3>Additional risk criteria<sup>2</sup></h3>
          <dl class="lm-risk">${rk.map(r => { const v = (D.risk || {})[r.id] || "Low"; return `<dt>${hesc(r.name)}</dt><dd><span class="pill" style="background:${RISKC[v] || "#7D8B97"}">${hesc(v)}</span></dd>`; }).join("")}</dl></div>` : ""}
      </div>
    </section>`;
  };
  return `<div class="lm">
    <header class="lm-head">
      ${logo ? `<img src="data:image/png;base64,${logo.b64}" alt="45th Weather Squadron">` : `<img src="45ws-logo.png" alt="45th Weather Squadron" onerror="this.remove()">`}
      <div class="lm-title"><p class="lm-kicker">45th Weather Squadron</p><h1>Launch Mission Execution Forecast</h1>
        <div class="lm-mission"><b>${hesc(L.mission || "Mission name")}</b><span>${hesc(L.vehicle || "")}${pad ? " · " + pad.name : ""}</span></div></div>
      <div class="lm-meta"><div><span>Issued</span><b>${issuedText(issued)}</b></div><div><span>Launch window</span><b>${winText(W0.a, W0.b)}</b></div></div>
    </header>
    <section class="lm-disc"><h3>Forecast discussion</h3><p>${hesc(L.discussion || "").replace(/\n/g, "<br>")}</p></section>
    ${(L.windows || []).map((w, i) => day(i, w)).join("")}
    <footer class="lm-foot">
      <div class="lm-next"><span>Next forecast will be issued</span><b>${hesc(L.next || "As Required")}</b></div>
      <ol><li>The probability of violation (PoV) is the chance of a local safety or customer weather constraint violation occurring at any random time during the launch window.</li>
      ${risksOn().length ? `<li>Additional risk criteria are not included in the PoV. They are mission-specific constraints and may not include every phenomenon within each risk factor.</li>` : ""}</ol>
    </footer>
  </div>`;
}
const LM_CSS = `.lm{font-family:"Barlow","Segoe UI",Arial,sans-serif;color:#13202E;background:#fff;max-width:900px;margin:0 auto;border-radius:14px;overflow:hidden;box-shadow:0 1px 0 #D4DBDF}
.lm-head{display:grid;grid-template-columns:auto 1fr auto;gap:18px;align-items:center;padding:20px 24px;background:linear-gradient(120deg,#0B1D33 0%,#123457 60%,#1C4A73 100%);color:#fff}
.lm-head img{height:92px;width:auto;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))}
.lm-kicker{margin:0;font:600 12px/1 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:1.6px;text-transform:uppercase;color:#FBB940}
.lm-title h1{margin:4px 0 8px;font:700 28px/1.05 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:.3px}
.lm-mission b{display:block;font:700 20px/1.15 "Barlow",Arial,sans-serif}.lm-mission span{font-size:14px;opacity:.85}
.lm-meta{display:grid;gap:8px;text-align:right;font-size:13px}.lm-meta span{display:block;opacity:.7;font-size:11px;letter-spacing:.8px;text-transform:uppercase}.lm-meta b{font-weight:600}
.lm-disc{padding:16px 24px;border-bottom:1px solid #E6EBED}.lm h3{margin:0 0 6px;font:700 12px/1 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:1px;text-transform:uppercase;color:#4B5A68}
.lm-disc p{margin:0;font-size:14.5px;line-height:1.5}
.lm-day{padding:16px 24px 18px;border-bottom:1px solid #E6EBED}.lm-dayhead{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.lm-dayhead h2{margin:0;font:700 22px/1 "Barlow Condensed","Arial Narrow",sans-serif}.lm-dayhead span{font-size:13px;color:#4B5A68}
.lm-pov{display:grid;grid-template-columns:auto 1fr;gap:20px;align-items:center;margin-bottom:14px}
.lm-gauge{width:132px;height:132px;border-radius:50%;background:conic-gradient(var(--c) calc(var(--p)*1%),#E6EBED 0);display:grid;place-items:center}
.lm-gauge>div{width:104px;height:104px;border-radius:50%;background:#fff;display:grid;place-items:center;text-align:center;align-content:center}
.lm-gauge b{font:700 38px/1 "Barlow",Arial,sans-serif}.lm-gauge small{font-size:18px}.lm-gauge span{font-size:9.5px;line-height:1.2;color:#4B5A68;max-width:80px;letter-spacing:.3px;text-transform:uppercase}
.lm-chips{display:flex;flex-wrap:wrap;gap:6px}.lm-chips span{background:#EEF3F7;border:1px solid #D4DBDF;border-radius:999px;padding:4px 12px;font-weight:600;font-size:14px}
.lm-lvl{margin:8px 0 0;font-weight:700;font-size:13px;letter-spacing:.3px}
.lm-seg{margin:0 0 14px;padding:10px 14px 8px;border:1px solid #E1E7EB;border-radius:10px;background:#FAFBFC}.lm-seg p{margin:6px 0 0;font-size:13px;font-weight:600}
.lm-bars{display:flex;gap:6px;align-items:flex-end;height:110px}.lm-bars .b{flex:1;display:grid;grid-template-rows:1fr auto auto;height:100%;text-align:center;min-width:0;align-items:end}.lm-bars .b > i{height:100%}.lm-bars i{display:block;align-self:end;border-radius:4px 4px 0 0}.lm-bars b{font-size:11.5px;margin-top:2px}.lm-bars span{font-size:10.5px;color:#7D8B97}
.lm-grid{display:grid;grid-template-columns:1.1fr 1.3fr 1fr;gap:12px}.lm-grid.two{grid-template-columns:1fr 1.3fr}.lm-card{border:1px solid #E1E7EB;border-radius:10px;padding:12px 14px;background:#FAFBFC}
.lm-card dl{margin:0;display:grid;gap:4px}.lm-card dt{font-size:11.5px;color:#4B5A68}.lm-card dd{margin:0 0 4px;font-weight:600;font-size:14px}
.lm-card table{width:100%;border-collapse:collapse;font-size:13px}.lm-card th{text-align:left;font-size:10.5px;color:#7D8B97;font-weight:600;padding:2px 4px;text-transform:uppercase;letter-spacing:.4px}.lm-card td{padding:4px;font-weight:600;border-top:1px solid #E6EBED}
.lm-risk{grid-template-columns:1fr auto;align-items:center}.lm-risk dd{margin:0}.pill{display:inline-block;color:#fff;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700}
.lm-foot{padding:14px 24px 18px;background:#F6F8F9;font-size:11.5px;color:#4B5A68}.lm-next{display:flex;gap:10px;align-items:baseline;margin-bottom:6px}.lm-next span{text-transform:uppercase;letter-spacing:.8px;font-size:11px}.lm-next b{color:#13202E;font-size:13px}
.lm-foot ol{margin:4px 0 0;padding-left:18px}.lm-foot li{margin:2px 0}
@media (max-width:760px){.lm-head{grid-template-columns:auto 1fr}.lm-meta{grid-column:1/-1;text-align:left}.lm-grid,.lm-grid.two{grid-template-columns:1fr}}`;

/* ---------- exports ---------- */
function fieldRows(){
  const pad = PADS.find(p => p.id === L.pad) || PADS[2], W0 = (L.windows || [])[0] || {}, out = [];
  out.push(["Mission", L.mission], ["Vehicle", L.vehicle], ["Pad", pad.full], ["Issued", issuedText(L.issued || Date.now())], ["Launch window", winText(W0.a, W0.b)], ["Forecast discussion", L.discussion]);
  (L.windows || []).forEach((w, i) => {
    const D = L.days[i] || {}, lab = winLabel(i);
    out.push([`${lab} window`, winText(w.a, w.b)], [`${lab} PoV`, `${D.pov ?? ""}%`]);
    if (segOn(D)){ D.seg.forEach(sg => out.push([`${lab} PoV ${lHM(sg.a)}–${lHM(sg.b)}L`, `${sg.pov}%`])); out.push([`${lab} PoV through the window`, segSummary(D)]); }
    out.push( [`${lab} primary concerns`, D.concerns], [`${lab} weather/visibility`, `${D.wx || ""} / ${D.vis || ""}`], [`${lab} temperature/humidity`, `${D.temp || ""} / ${D.rh || ""}`], [`${lab} liftoff winds (200 ft)`, D.wind]);
    (D.clouds || []).forEach((c, k) => out.push([`${lab} cloud layer ${k + 1}`, c.type === "None" ? "None" : `${c.type}, ${c.cov}, base ${c.base ?? "-"} ft, tops ${c.tops ?? "-"} ft`]));
    risksOn().forEach(r => out.push([`${lab} ${r.name.toLowerCase()}`, (D.risk || {})[r.id] || "Low"]));
  });
  out.push(["Next forecast will be issued", L.next]);
  return out;
}
function csvLMEF(){
  const q = v => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return ["field,value", ...fieldRows().map(r => r.map(q).join(","))].join("\r\n") + "\r\n";
}
function xlsxLMEF(logo){
  const rows = [], merges = [], heights = {};
  rows.push([{ v:"Launch Mission Execution Forecast", s:1 }]); heights[0] = 24; merges.push("A1:C1");
  rows.push([{ v:`${L.mission || ""}  |  ${L.vehicle || ""}  |  ${(PADS.find(p => p.id === L.pad) || {}).name || ""}`, s:2 }]); merges.push("A2:C2");
  rows.push([]); rows.push([]);
  let section = null;
  const labs = (L.windows || []).map((w, i) => winLabel(i));
  for (const [k, v] of fieldRows()){
    const sec = labs.find(l => k.startsWith(l + " ")) || "Mission";
    if (sec !== section){ section = sec; const r = rows.length + 1; rows.push([{ v:sec, s:3 }, { v:"", s:3 }, { v:"", s:3 }]); merges.push(`A${r}:C${r}`); }
    const r = rows.length + 1; rows.push([{ v:(sec === "Mission" ? k : k.slice(sec.length + 1)).replace(/^./, c => c.toUpperCase()), s:8 }, { v:String(v ?? ""), s:5 }, { v:"", s:5 }]); merges.push(`B${r}:C${r}`);
    if (k === "Forecast discussion") heights[r - 1] = Math.min(160, 15*Math.ceil(String(v || "").length/90) + 6);
  }
  return workbook([{ name:"LMEF", rows, merges, heights, freeze:null, grid:false, cols:[34, 60, 30], cf:[] }], logo);
}
function pdfLMEF(logo){
  const W = 612, Hp = 792, M = 34, pages = []; let cs = [];
  const f = n => (+n).toFixed(2), rgbf = c => c.map(x => f(x/255)).join(" ");
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const rect = (x, y, w, h, fill) => cs.push(`${rgbf(fill)} rg ${f(x)} ${f(Hp - y - h)} ${f(w)} ${f(h)} re f`);
  const stroke = (x, y, w, h, c, lw) => cs.push(`${rgbf(c)} RG ${f(lw || .6)} w ${f(x)} ${f(Hp - y - h)} ${f(w)} ${f(h)} re S`);
  const text = (s, x, y, size, opt = {}) => { const w = textW(s, size, opt.bold); let tx = x; if (opt.align === "c") tx = x - w/2; else if (opt.align === "r") tx = x - w; cs.push(`BT ${rgbf(opt.color || [19,32,46])} rg /${opt.bold ? "F2" : "F1"} ${f(size)} Tf ${f(tx)} ${f(Hp - y)} Td ${pdfStr(s)} Tj ET`); };
  const wrap = (s, maxW, size, bold) => { const out = []; for (const para of String(s || "").split("\n")){ let ln = ""; for (const w of para.split(/\s+/)){ const t = ln ? ln + " " + w : w; if (textW(t, size, bold) > maxW && ln){ out.push(ln); ln = w; } else ln = t; } out.push(ln); } return out; };
  const arc = (cx, cy, r, a0, a1) => { const n = Math.max(8, Math.ceil((a1 - a0)/4)); let d = ""; for (let i = 0; i <= n; i++){ const a = (-90 + a0 + (a1 - a0)*i/n)*Math.PI/180; d += `${f(cx + r*Math.cos(a))} ${f(Hp - (cy + r*Math.sin(a)))} ${i ? "l" : "m"} `; } cs.push(d + "S"); };
  const gauge = (cx, cy, r, pct, col) => { cs.push(`${rgbf([230,235,237])} RG 9 w`); arc(cx, cy, r, 0, 360); if (pct > 0){ cs.push(`${rgbf(col)} RG 9 w 1 J`); arc(cx, cy, r, 0, 360*Math.min(100, pct)/100); } };
  const pad = PADS.find(p => p.id === L.pad) || PADS[2], W0 = (L.windows || [])[0] || {};
  const header = full => {
    const hh = full ? 104 : 46; rect(0, 0, W, hh, [13,32,56]); rect(0, hh - 3, W, 3, [251,185,64]);
    let tx = M;
    if (logo){ const lh = full ? 76 : 32, lw = lh*logo.rw/logo.rh; cs.push(`q ${f(lw)} 0 0 ${f(lh)} ${f(M)} ${f(Hp - (full ? 14 : 7) - lh)} cm /Im1 Do Q`); tx = M + lw + 14; }
    if (full){
      text("45TH WEATHER SQUADRON", tx, 28, 8, { bold:true, color:[251,185,64] });
      text("Launch Mission Execution Forecast", tx, 48, 18, { bold:true, color:[255,255,255] });
      text(L.mission || "Mission name", tx, 68, 13, { bold:true, color:[255,255,255] });
      text(`${L.vehicle || ""}  |  ${pad.full}`, tx, 84, 9, { color:[205,216,226] });
      text("ISSUED", W - M, 30, 6.5, { bold:true, align:"r", color:[170,186,201] }); text(issuedText(L.issued || Date.now()), W - M, 41, 8.5, { align:"r", color:[255,255,255] });
      text("LAUNCH WINDOW", W - M, 58, 6.5, { bold:true, align:"r", color:[170,186,201] }); text(winText(W0.a, W0.b), W - M, 69, 8.5, { align:"r", color:[255,255,255] });
    } else { text(`Launch Mission Execution Forecast: ${L.mission || ""} (continued)`, tx, 28, 11, { bold:true, color:[255,255,255] }); }
    return hh;
  };
  let y = header(true) + 18;
  text("FORECAST DISCUSSION", M, y, 7.5, { bold:true, color:[75,90,104] }); y += 12;
  for (const ln of wrap(L.discussion, W - 2*M, 9.5, false).slice(0, 12)){ text(ln, M, y, 9.5); y += 12.5; }
  y += 6;
  const rk = risksOn(), chH = Math.max(98, 34 + rk.length*22), footH = 80;
  (L.windows || []).forEach((w, i) => {
    const D = L.days[i] || {}, [pc] = POVC(+D.pov || 0), col = hex(pc), segH = segOn(D) ? 74 : 0, secH = 28 + 92 + segH + chH + 14;
    if (y + secH > Hp - footH){ pages.push(cs); cs = []; y = header(false) + 18; }
    rect(M, y, W - 2*M, 0.8, [212,219,223]); y += 16;
    text(winLabel(i).replace(/^./, c => c.toUpperCase()), M, y, 15, { bold:true }); text(winText(w.a, w.b), W - M, y, 8.5, { align:"r", color:[75,90,104] }); y += 12;
    const gy = y + 42; gauge(M + 42, gy, 32, +D.pov || 0, col);
    text(`${D.pov ?? "-"}%`, M + 42, gy + 6, 20, { bold:true, align:"c" }); text("PoV", M + 42, gy + 17, 6.5, { align:"c", color:[75,90,104] });
    text("PRIMARY CONCERNS", M + 98, y + 18, 7, { bold:true, color:[75,90,104] });
    let cx = M + 98, cy = y + 28;
    for (const c of String(D.concerns || "None").split(/\s*,\s*/).filter(Boolean)){ const w2 = textW(c, 9.5, true) + 18; if (cx + w2 > W - M){ cx = M + 98; cy += 22; } rect(cx, cy, w2, 17, [238,243,247]); stroke(cx, cy, w2, 17, [212,219,223], .6); text(c, cx + 9, cy + 12, 9.5, { bold:true }); cx += w2 + 6; }
    text(`${POVC(+D.pov || 0)[1]} weather risk`, M + 98, cy + 34, 8.5, { bold:true, color:col });
    y = gy + 46;
    if (segOn(D)){
      rect(M, y, W - 2*M, segH - 8, [250,251,252]); stroke(M, y, W - 2*M, segH - 8, [225,231,235], .6);
      text("POV THROUGH THE WINDOW", M + 9, y + 12, 7, { bold:true, color:[75,90,104] });
      const n = D.seg.length, bx0 = M + 9, bw = (W - 2*M - 18)/n, base = y + 42, maxH = 20, top = Math.max(50, ...D.seg.map(x => +x.pov));
      D.seg.forEach((sg, k) => { const hgt = Math.max(2, maxH*(+sg.pov)/top), c2 = hex(POVC(+sg.pov)[0]); rect(bx0 + k*bw + 2, base - hgt, bw - 4, hgt, c2); text(`${sg.pov}%`, bx0 + k*bw + bw/2, base - hgt - 2, 6.5, { bold:true, align:"c" }); text(lHM(sg.a), bx0 + k*bw + bw/2, base + 8, 6, { align:"c", color:[125,139,151] }); });
      text(segSummary(D), M + 9, y + segH - 15, 7.5, { bold:true });
      y += segH;
    }
    const ncard = rk.length ? 3 : 2, cw = (W - 2*M - (ncard - 1)*8)/ncard;
    const card = (x, title2) => { rect(x, y, cw, chH, [250,251,252]); stroke(x, y, cw, chH, [225,231,235], .6); text(title2, x + 9, y + 13, 7, { bold:true, color:[75,90,104] }); };
    card(M, "WEATHER CONDITIONS");
    [["Weather / visibility", `${D.wx || "-"} / ${D.vis || "-"}`], ["Temperature / humidity", `${D.temp || "-"} / ${D.rh || "-"}`], ["Liftoff winds (200 ft)", D.wind || "-"]].forEach(([l, v], k) => { text(l, M + 9, y + 28 + k*25, 7, { color:[75,90,104] }); text(v, M + 9, y + 40 + k*25, 9.5, { bold:true }); });
    const x2 = M + cw + 8; card(x2, "CLOUDS");
    const cx4 = [0, 0.39, 0.63, 0.81].map(p => x2 + 9 + p*(cw - 18));
    ["Type","Cover","Base","Tops"].forEach((h, k) => text(h.toUpperCase(), cx4[k], y + 27, 6, { bold:true, color:[125,139,151] }));
    (D.clouds || []).slice(0, 5).forEach((c, r) => { const yy = y + 41 + r*14; [c.type, c.cov || "", c.base ? Number(c.base).toLocaleString("en-US") : "-", c.tops ? Number(c.tops).toLocaleString("en-US") : "-"].forEach((v, k) => { const mw = (k < 3 ? cx4[k + 1] - cx4[k] : x2 + cw - 9 - cx4[k]) - 3; text(String(v), cx4[k], yy, lmFit(String(v), mw, k === 0 ? 7.5 : 8, true), { bold:true }); }); });
    if (rk.length){
      const x3 = M + 2*(cw + 8); card(x3, "ADDITIONAL RISK CRITERIA");
      rk.forEach((r, k) => { const v = (D.risk || {})[r.id] || "Low", yy = y + 30 + k*22; text(r.name, x3 + 9, yy + 8, 7.5); const c2 = hex(RISKC[v] || "#7D8B97"), w2 = textW(v, 7.5, true) + 14; rect(x3 + cw - 9 - w2, yy, w2, 12, c2); text(v, x3 + cw - 9 - w2/2, yy + 8.8, 7.5, { bold:true, align:"c", color:[255,255,255] }); });
    }
    y += chH + 14;
  });
  rect(0, Hp - 74, W, 74, [246,248,249]);
  text("NEXT FORECAST WILL BE ISSUED", M, Hp - 56, 7, { bold:true, color:[75,90,104] }); text(L.next || "As Required", M + 150, Hp - 56, 9, { bold:true });
  const notes = ["1. The probability of violation (PoV) is the chance of a local safety or customer weather constraint violation occurring at any random time during the launch window."];
  if (rk.length) notes.push("2. Additional risk criteria are not included in the PoV. They are mission-specific constraints and may not include every phenomenon within each risk factor.");
  let ny = Hp - 40; for (const n of notes) for (const ln of wrap(n, W - 2*M, 7, false)){ text(ln, M, ny, 7, { color:[75,90,104] }); ny += 9; }
  pages.push(cs);
  return pdfAssemble(pages.map(p => p.join("\n")), logo, W, Hp);
}
function htmlLMEF(logo){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LMEF ${hesc(L.mission || "")}</title><link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&family=Barlow+Condensed:wght@600;700&display=swap" rel="stylesheet"><style>body{margin:0;padding:24px;background:#EEF2F4}${LM_CSS}@media print{body{background:#fff;padding:0}.lm{box-shadow:none}}</style></head><body>${productHTML(logo)}</body></html>`;
}

/* ---------- editor ---------- */
function lmRenderStatus(){
  const n = Object.keys(SX.status).length;
  $("lmLive").textContent = DEMO ? "Demo guidance (synthetic data)" : SX.loading ? `Loading guidance for the pad, ${n} sources in` : `Guidance from ${n} sources at ${(PADS.find(p => p.id === L.pad) || {}).name}`;
}
function renderMissions(){
  $("lmMission").innerHTML = `<option value="">Custom mission (type the details)</option>` + SX.launches.map(x => `<option value="${hesc(x.id)}" ${x.id === L.missionId ? "selected" : ""}>${hesc(lDate(x.net))} ${lHM(x.net)}L · ${hesc(x.vehicle)} · ${hesc(x.name)}${x.pad ? "" : " (pad not listed)"}</option>`).join("");
}
const opt = (list, v) => list.map(x => `<option ${x === v ? "selected" : ""}>${x}</option>`).join("");
function renderEditor(){
  const ae = document.activeElement, set = (id, v) => { if ($(id) !== ae) $(id).value = v ?? ""; };
  set("lmName", L.mission); set("lmVeh", L.vehicle); $("lmPad").value = L.pad; set("lmIss", toInput(L.issued || Date.now()));
  set("lmDisc", L.discussion); set("lmNext", L.next);
  /* liftoff constraint and flight through precipitation */
  if (!$("lmLift").contains(ae)) $("lmLift").innerHTML = `<label>Height <span class="u"><input data-l="h" type="number" min="10" max="600" value="${L.liftoff.h}"> ft</span></label><label>Wind <select data-l="kind">${[["peak","Peak"],["sust","Sustained"]].map(([v, l]) => `<option value="${v}" ${L.liftoff.kind === v ? "selected" : ""}>${l}</option>`).join("")}</select></label><label>Limit <span class="u"><select data-l="op"><option value=">" ${L.liftoff.op === ">" ? "selected" : ""}>&gt;</option><option value=">=" ${L.liftoff.op === ">=" ? "selected" : ""}>≥</option></select><input data-l="v" type="number" min="0" value="${L.liftoff.v}"></span></label><label>Units <select data-l="unit">${Object.keys(WIND_UNITS).map(u => `<option ${u === L.liftoff.unit ? "selected" : ""}>${u}</option>`).join("")}</select></label>`;
  $("lmFtp").checked = !!L.ftp;
  /* windows */
  if (!$("lmWins").contains(ae)) $("lmWins").innerHTML = (L.windows || []).map((w, i) => `<div class="wrow" data-w="${i}"><span>${winLabel(i)}</span><input type="datetime-local" data-wa="a" value="${toInput(w.a)}"><input type="datetime-local" data-wa="b" value="${toInput(w.b)}">${i ? `<button type="button" class="x" data-delw="${i}" aria-label="Remove ${winLabel(i)}">×</button>` : "<i></i>"}</div>`).join("") + `<button type="button" class="lnk" id="lmAddWin">+ add delay day</button>`;
  /* risk criteria */
  if (!$("lmRisks").contains(ae)) $("lmRisks").innerHTML = L.risks.map((r, i) => { const b = BUILTIN_RISKS.find(x => x.id === r.id); return `<div class="rrow" data-r="${i}"><input type="checkbox" data-ron ${r.on ? "checked" : ""} aria-label="Show ${hesc(r.name)}">${b ? `<span>${hesc(r.name)}<small>auto from ${b.auto}</small></span><i></i>` : `<input data-rname value="${hesc(r.name)}" placeholder="Criterion name"><button type="button" class="x" data-delr="${i}" aria-label="Remove">×</button>`}</div>`; }).join("") + `<button type="button" class="lnk" id="lmAddRisk">+ custom criterion</button>`;
  /* recovery sites */
  if (!$("lmRec").contains(ae)) $("lmRec").innerHTML = ((L.recovery || []).length ? `<div class="recrow hd"><span>Site</span><span>Latitude</span><span>Longitude</span><span>Max wind</span><span>Max seas</span><i></i></div>` : `<p class="mut">Add the booster or fairing recovery site to evaluate its winds and seas against your limits for Booster Recovery Weather.</p>`) + (L.recovery || []).map((r, i) => `<div class="recrow" data-k="${i}"><input data-rc="name" value="${hesc(r.name || "")}" placeholder="Site (e.g. ASDS)"><input data-rc="lat" inputmode="decimal" value="${r.lat ?? ""}" placeholder="Lat"><input data-rc="lon" inputmode="decimal" value="${r.lon ?? ""}" placeholder="Lon"><span class="u"><input data-rc="windKt" type="number" value="${r.windKt ?? ""}" placeholder="Wind"> kt</span><span class="u"><input data-rc="waveFt" type="number" step="0.5" value="${r.waveFt ?? ""}" placeholder="Seas"> ft</span><button type="button" class="x" data-delrec="${i}" aria-label="Remove site">×</button></div>`).join("") + `<button type="button" class="lnk" id="lmAddRec">+ recovery site</button>`;
  /* one editor per window */
  const box = $("lmDays");
  if (!box.contains(ae)) box.innerHTML = (L.windows || []).map((w, i) => {
    const D = L.days[i] || {}, g = SX.guide[i];
    const note = g && g.outOfRange ? `<p class="mut">This window is beyond the guidance (about 8 days). Fill it in by hand.</p>` : g && g.parts ? `<p class="mut gd">Guidance first guess: PoV ${g.pov}% from ${g.parts.filter(p => p[1] > 0).map(p => `${p[0]}${p[0] === "Liftoff Winds" ? ` (${liftoffText()})` : ""} ${p[1]}%`).join(", ") || "no concerns"}.${Object.keys(g.why || {}).length ? " " + Object.entries(g.why).map(([k, v]) => `${(L.risks.find(r => r.id === k) || {}).name || k}: ${v}`).join(". ") + "." : ""}${D.edited ? ` <button type="button" class="lnk" data-reset="${i}">Use guidance</button>` : ""}</p>` : "";
    return `<details class="dayed" open><summary>${winLabel(i).replace(/^./, c => c.toUpperCase())}</summary>${dayFields(i, D)}${segFields(i, D)}${note}</details>`;
  }).join("");
}
const liftoffText = () => `${L.liftoff.kind === "sust" ? "sustained" : "peak"} ${L.liftoff.op === ">=" ? "≥" : ">"} ${L.liftoff.v} ${L.liftoff.unit} at ${L.liftoff.h} ft`;
function dayFields(i, D){
  const clouds = (D.clouds && D.clouds.length ? D.clouds : [{ type:"None" }]);
  return `<div class="edgrid" data-day="${i}">
    <label class="pv">PoV % <input data-f="pov" type="number" min="0" max="100" step="5" value="${D.pov ?? ""}"></label>
    <label class="wide">Primary concerns <input data-f="concerns" list="lmConcernList" value="${hesc(D.concerns || "")}" placeholder="e.g. Cumulus Cloud Rule, Liftoff Winds"></label>
    <label>Weather <input data-f="wx" value="${hesc(D.wx || "")}"></label>
    <label>Visibility <input data-f="vis" value="${hesc(D.vis || "")}"></label>
    <label>Temperature <input data-f="temp" value="${hesc(D.temp || "")}"></label>
    <label>Humidity <input data-f="rh" value="${hesc(D.rh || "")}"></label>
    <label class="wide">Liftoff winds (200 ft) <input data-f="wind" value="${hesc(D.wind || "")}" placeholder="150° 5 - 10 mph"></label>
    <div class="wide clouds"><span>Clouds</span>${clouds.map((c, k) => `<div class="crow" data-i="${k}"><input data-c="type" value="${hesc(c.type || "")}" placeholder="Type"><select data-c="cov">${opt(["","Few","Scattered","Broken","Overcast"], c.cov || "")}</select><input data-c="base" type="number" step="500" value="${c.base ?? ""}" placeholder="Base"><input data-c="tops" type="number" step="500" value="${c.tops ?? ""}" placeholder="Tops"><button type="button" class="x" data-delc="${k}" aria-label="Remove layer">×</button></div>`).join("")}<button type="button" class="lnk" data-addc="1">+ cloud layer</button></div>
    ${risksOn().map(r => `<label>${hesc(r.name)} <select data-risk="${r.id}">${opt(RISK, (D.risk || {})[r.id] || "Low")}</select></label>`).join("")}
  </div>`;
}
function segFields(i, D){
  if (!D.seg || D.seg.length < 2) return "";
  return `<div class="segs" data-day="${i}"><div class="segh"><label class="chk"><input type="checkbox" data-segon ${D.showSeg !== false ? "checked" : ""}> Show PoV through the window</label><button type="button" class="lnk" data-segavg="${i}">set headline to the average</button></div>
    <div class="segrow">${D.seg.map((s, k) => `<label><span>${lHM(s.a)}</span><input type="number" min="0" max="100" step="5" data-seg="${k}" value="${s.pov}"></label>`).join("")}</div></div>`;
}
function renderPreview(){ $("lmPreview").innerHTML = productHTML(null); }
function lmRenderAll(){ lmRenderStatus(); renderEditor(); renderPreview(); }
function refresh(full){ saveL(); if (full) loadGuidance(); else { analyzeAll(); lmRenderAll(); } }
function pickMission(id){
  const x = SX.launches.find(l => l.id === id); L.missionId = id || "";
  if (x){
    L.mission = x.name; L.vehicle = x.vehicle; if (x.pad) L.pad = x.pad;
    const b = Math.max(x.w1, x.w0);
    L.windows = [{ a:x.w0, b }, { a:x.w0 + 24*H, b:b + 24*H }];
    const lim = Object.keys(VEHICLE_LIMITS).find(v => (x.vehicle || "").includes(v)); if (lim){ L.liftoff.v = VEHICLE_LIMITS[lim]; L.liftoff.unit = "kt"; }
    L.days = []; L.discussionEdited = false;
  }
  saveL(); loadGuidance(); lmRenderAll();
}
function bindLM(){
  $("lmMission").onchange = e => pickMission(e.target.value);
  const fld = (id, key, conv, full) => $(id).addEventListener("change", e => { L[key] = conv ? conv(e.target.value) : e.target.value; if (key === "pad") L.days = []; refresh(full); });
  fld("lmName", "mission"); fld("lmVeh", "vehicle"); fld("lmPad", "pad", null, true); fld("lmIss", "issued", fromInput); fld("lmNext", "next");
  ["lmName","lmVeh","lmNext"].forEach(id => $(id).addEventListener("input", e => { L[{ lmName:"mission", lmVeh:"vehicle", lmNext:"next" }[id]] = e.target.value; saveL(); renderPreview(); }));
  $("lmDisc").addEventListener("input", e => { L.discussion = e.target.value; L.discussionEdited = true; saveL(); renderPreview(); });
  $("lmDiscReset").onclick = () => { L.discussionEdited = false; L.discussion = draftDiscussion(); saveL(); lmRenderAll(); };
  $("lmLift").addEventListener("change", e => { const k = e.target.dataset.l; if (!k) return; L.liftoff[k] = e.target.type === "number" ? +e.target.value : e.target.value; setHeights(); L.days.forEach(d => d && !d.edited && (d.concerns = d.concerns)); refresh(false); });
  $("lmFtp").onchange = e => { L.ftp = e.target.checked; refresh(false); };
  /* windows */
  $("lmWins").addEventListener("change", e => { const row = e.target.closest("[data-w]"); if (!row || !e.target.dataset.wa) return; const i = +row.dataset.w, v = fromInput(e.target.value); if (v == null) return; L.windows[i][e.target.dataset.wa] = v; if (i === 0){ const dur = L.windows[0].b - L.windows[0].a; L.windows.forEach((w, k) => { if (k && !w.custom){ w.a = L.windows[0].a + k*24*H; w.b = w.a + dur; } }); } else L.windows[i].custom = true; if (L.days[i]) L.days[i].edited = false; refresh(false); });
  $("lmWins").addEventListener("click", e => {
    if (e.target.tagName === "BUTTON") e.target.blur();
    if (e.target.id === "lmAddWin"){ const last = L.windows[L.windows.length - 1]; L.windows.push({ a:last.a + 24*H, b:last.b + 24*H }); refresh(false); }
    if (e.target.dataset.delw){ const i = +e.target.dataset.delw; L.windows.splice(i, 1); L.days.splice(i, 1); refresh(false); }
  });
  /* risk criteria */
  $("lmRisks").addEventListener("change", e => { const row = e.target.closest("[data-r]"); if (!row) return; const r = L.risks[+row.dataset.r]; if (e.target.hasAttribute("data-ron")) r.on = e.target.checked; if (e.target.hasAttribute("data-rname")) r.name = e.target.value; refresh(false); });
  $("lmRisks").addEventListener("input", e => { if (!e.target.hasAttribute("data-rname")) return; const r = L.risks[+e.target.closest("[data-r]").dataset.r]; r.name = e.target.value; saveL(); renderPreview(); });
  $("lmRisks").addEventListener("click", e => {
    if (e.target.tagName === "BUTTON") e.target.blur();
    if (e.target.id === "lmAddRisk"){ L.risks.push({ id:"c" + Date.now().toString(36), name:"", on:true }); saveL(); lmRenderAll(); const ins = $("lmRisks").querySelectorAll("[data-rname]"); if (ins.length) ins[ins.length - 1].focus(); }
    if (e.target.dataset.delr){ L.risks.splice(+e.target.dataset.delr, 1); refresh(false); }
  });
  /* recovery sites */
  $("lmRec").addEventListener("change", e => { const row = e.target.closest("[data-k]"); if (!row) return; const r = L.recovery[+row.dataset.k], k = e.target.dataset.rc; r[k] = ["lat","lon","windKt","waveFt"].includes(k) ? (e.target.value === "" ? null : +e.target.value) : e.target.value; saveL(); if (k === "lat" || k === "lon") loadRecovery(); else refresh(false); });
  $("lmRec").addEventListener("click", e => {
    if (e.target.tagName === "BUTTON") e.target.blur();
    if (e.target.id === "lmAddRec"){ L.recovery.push({ id:"r" + Date.now().toString(36), name:"ASDS", lat:null, lon:null, windKt:25, waveFt:8 }); saveL(); lmRenderAll(); }
    if (e.target.dataset.delrec){ L.recovery.splice(+e.target.dataset.delrec, 1); saveL(); loadRecovery(); }
  });
  /* per-window editors */
  const box = $("lmDays");
  const upd = e => {
    const grid = e.target.closest("[data-day]"); if (!grid) return; const i = +grid.dataset.day;
    const D = L.days[i] = L.days[i] || { clouds:[], risk:{} }; D.edited = true; D.risk = D.risk || {};
    const t = e.target;
    if (t.dataset.f) D[t.dataset.f] = t.dataset.f === "pov" ? (t.value === "" ? null : Math.max(0, Math.min(100, +t.value))) : t.value;
    if (t.dataset.risk) D.risk[t.dataset.risk] = t.value;
    if (t.dataset.seg != null && D.seg){ D.seg[+t.dataset.seg].pov = t.value === "" ? 0 : Math.max(0, Math.min(100, +t.value)); }
    if (t.hasAttribute && t.hasAttribute("data-segon")) D.showSeg = t.checked;
    if (t.dataset.c){ const k = +t.closest("[data-i]").dataset.i; D.clouds = D.clouds || []; D.clouds[k] = D.clouds[k] || {}; D.clouds[k][t.dataset.c] = t.type === "number" ? (t.value === "" ? null : +t.value) : t.value; }
    saveL(); renderPreview();
  };
  box.addEventListener("input", upd); box.addEventListener("change", upd);
  box.addEventListener("click", e => {
    if (e.target.tagName === "BUTTON") e.target.blur();
    const grid = e.target.closest("details"); const i = grid ? +grid.querySelector("[data-day]").dataset.day : null;
    if (e.target.dataset.addc){ const D = L.days[i] = L.days[i] || { clouds:[], risk:{} }; D.clouds = (D.clouds || []).filter(c => c.type !== "None"); D.clouds.push({ type:"", cov:"", base:null, tops:null }); D.edited = true; saveL(); box.innerHTML = ""; lmRenderAll(); }
    if (e.target.dataset.delc != null){ const D = L.days[i]; D.clouds.splice(+e.target.dataset.delc, 1); D.edited = true; saveL(); box.innerHTML = ""; lmRenderAll(); }
    if (e.target.dataset.segavg){ const k = +e.target.dataset.segavg, D = L.days[k]; if (D && D.seg){ const tot = D.seg.reduce((x, s) => x + (s.b - s.a), 0); D.pov = Math.round(D.seg.reduce((x, s) => x + (+s.pov)*(s.b - s.a), 0)/tot/5)*5; D.edited = true; saveL(); box.innerHTML = ""; lmRenderAll(); } }
    if (e.target.dataset.reset){ const k = +e.target.dataset.reset, g = SX.guide[k]; if (g && !g.outOfRange) L.days[k] = fromGuide(g, L.days[k]); saveL(); box.innerHTML = ""; lmRenderAll(); }
  });
  const stamp = () => { const p = lp(Date.now()); return `${p.y}${lpad(p.mo)}${lpad(p.d)}_${lpad(p.h)}${lpad(p.mi)}`; };
  const base = () => `LMEF_${(L.mission || "Mission").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}_${stamp()}`;
  $("lmPdf").onclick = async () => download(pdfLMEF(await loadLogo()), base() + ".pdf");
  $("lmHtml").onclick = async () => download(new Blob([htmlLMEF(await loadLogo())], { type:"text/html" }), base() + ".html");
  $("lmXlsx").onclick = async () => download(xlsxLMEF(await loadLogo()), base() + ".xlsx");
  $("lmCsv").onclick = () => download(new Blob([csvLMEF()], { type:"text/csv" }), base() + ".csv");
  $("lmRefresh").onclick = () => { fetchLaunches().then(l => { SX.launches = l; renderMissions(); }); loadGuidance(); };
  $("lmPad").innerHTML = PADS.map(p => `<option value="${p.id}">${p.name} (${p.full})</option>`).join("");
  $("lmConcernList").innerHTML = CONCERNS.map(c => `<option value="${c}">`).join("");
}
async function initLM(){
  const st = document.createElement("style"); st.textContent = LM_CSS; document.head.appendChild(st);
  document.querySelectorAll('.pagenav a[data-page="lmef"]').forEach(a => a.setAttribute("aria-current", "page"));
  if (!L.windows || !L.windows.length){ const t = Math.ceil(Date.now()/H)*H + 26*H; L.windows = [{ a:t, b:t + 4*H }, { a:t + 24*H, b:t + 28*H }]; }
  bindLM(); lmRenderAll();
  SX.launches = DEMO ? demoLaunches() : await fetchLaunches().catch(() => []);
  renderMissions();
  loadGuidance();
}
function demoLaunches(){ const t = Math.ceil(Date.now()/H)*H + 20*H; return [
  { id:"d1", name:"Starlink Group 10-11", vehicle:"Falcon 9", pad:"slc40", net:t, w0:t, w1:t + 4*H },
  { id:"d2", name:"USSF-106", vehicle:"Vulcan", pad:"slc41", net:t + 50*H, w0:t + 50*H, w1:t + 52*H },
  { id:"d3", name:"Crew-12", vehicle:"Falcon 9", pad:"lc39a", net:t + 100*H, w0:t + 100*H, w1:t + 100*H } ]; }
const lmFit = (t, maxW, size, bold) => { let z = size; while (z > 5 && textW(t, z, bold) > maxW) z -= 0.25; return z; };
initLM();
