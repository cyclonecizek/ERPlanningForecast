"use strict";
/* ============================================================
   Daily Planning Forecast — KSC / CCSFS / Patrick SFB
   Guidance: Open-Meteo deterministic + ensemble models, IEM MOS
   (LAMP, GFS, NAM, GFS-X, NBM text). Everything runs in the page.
   ============================================================ */
const TZ = "America/New_York";
const H = 3600e3;
const SITES = [
  { id:"ksc-inland", name:"KSC Inland",      point:"SLF",    stn:"KTTS", lat:28.6150, lon:-80.6945, hot:86 },
  { id:"ksc-pads",   name:"KSC Launch Pads", point:"LC-39B", stn:"KTTS", lat:28.6272, lon:-80.6208, hot:86 },
  { id:"cape-inland",name:"Cape Inland",     point:"KXMR",   stn:"KXMR", lat:28.4686, lon:-80.5667, hot:86 },
  { id:"cape-pad37", name:"Cape Launch Pad", point:"SLC-37", stn:"KXMR", lat:28.5314, lon:-80.5650, hot:86 },
  { id:"patrick",    name:"Patrick SFB",     point:"KCOF",   stn:"KCOF", lat:28.2349, lon:-80.6101, hot:90 },
];
const STATIONS = [...new Set(SITES.map(s => s.stn))];

const FAMILIES = {
  hires: { label:"High resolution", color:"var(--hires)" },
  blend: { label:"Blend",           color:"var(--blend)" },
  global:{ label:"Global",          color:"var(--global)" },
  ens:   { label:"Ensembles",       color:"var(--ens)" },
  mos:   { label:"MOS and LAMP",    color:"var(--mos)" },
  ct:    { label:"Calibrated thunder", color:"var(--ct)" },
};
const OM_DET = [
  { id:"hrrr", name:"HRRR",       model:"ncep_hrrr_conus",               fam:"hires" },
  { id:"nam3", name:"NAM 3 km",   model:"ncep_nam_conus",                fam:"hires" },
  { id:"nbm",  name:"NBM",        model:"ncep_nbm_conus",                fam:"blend" },
  { id:"gfs",  name:"GFS",        model:"gfs_seamless",                  fam:"global" },
  { id:"ifs",  name:"ECMWF IFS",  model:"ecmwf_ifs025",                  fam:"global" },
  { id:"aifs", name:"ECMWF AIFS", model:"ecmwf_aifs025_single",          fam:"global" },
  { id:"icon", name:"ICON",       model:"icon_global",                   fam:"global" },
  { id:"gem",  name:"GEM",        model:"gem_global",                    fam:"global" },
  { id:"ukmo", name:"UKMO",       model:"ukmo_global_deterministic_10km",fam:"global" },
];
const OM_ENS = [
  { id:"gefs",    name:"GEFS",      model:"gfs025",        fam:"ens" },
  { id:"eps",     name:"ECMWF ENS", model:"ecmwf_ifs025",  fam:"ens" },
  { id:"aifsens", name:"AIFS ENS",  model:"ecmwf_aifs025", fam:"ens" },
  { id:"iconeps", name:"ICON EPS",  model:"icon_global",   fam:"ens" },
  { id:"geps",    name:"GEPS",      model:"gem_global",    fam:"ens" },
];
const MOS = [
  { id:"lav", name:"LAMP",            model:"LAV",  fam:"mos" },
  { id:"mav", name:"GFS MOS",         model:"GFS",  fam:"mos" },
  { id:"met", name:"NAM MOS",         model:"NAM",  fam:"mos" },
  { id:"mex", name:"GFS MOS extended",model:"GFSX", fam:"mos" },
  { id:"nbs", name:"NBM text",        model:"NBS",  fam:"mos" },
  { id:"nbe", name:"NBM text extended",model:"NBE", fam:"mos" },
];
/* written by pipeline/planning_hires.py into data/hires.json */
const PIPE = [
  { id:"rrfs",   name:"RRFS",                    fam:"hires" },
  { id:"refsm",  name:"REFS members",            fam:"hires" },
  { id:"hrefct", name:"HREF calibrated thunder", fam:"ct", w:2 },
  { id:"refsct", name:"REFS calibrated thunder", fam:"ct", w:2 },
];
const ALL_SOURCES = [...OM_DET.slice(0, 2), PIPE[0], PIPE[1], ...OM_DET.slice(2), ...OM_ENS, ...MOS, PIPE[2], PIPE[3]];

/* ---------- parameters (matrix columns) ---------- */
const SKY = [ ["CLR",0,6.25], ["FEW",6.25,31.25], ["SCT",31.25,56.25], ["BKN",56.25,93.75], ["OVC",93.75,101] ];
const SKY_MID = { CLR:0, FEW:19, SCT:44, BKN:75, OVC:100 };
const SEV = ["-","MRGL","SLGT","ENH","MDT","HIGH"];
const SEV_NAME = { "-":"None", MRGL:"Marginal", SLGT:"Slight", ENH:"Enhanced", MDT:"Moderate", HIGH:"High" };
const PARAMS = [
  { k:"sky",  g:"Sky",            l:"Cloud cover", s:"",      kind:"sky",  unit:"% cover", step:5,  lo:0, hi:100, title:"Sky cover" },
  { k:"t",    g:"Temperature (°F)", l:"Temp",      s:"",      kind:"num",  unit:"°F", step:1, title:"Temperature" },
  { k:"td",   g:"Temperature (°F)", l:"Dew point", s:"",      kind:"num",  unit:"°F", step:1, title:"Dew point" },
  { k:"wbgt", g:"Temperature (°F)", l:"WBGT",      s:"est.",  kind:"num",  unit:"°F", step:1, title:"Wet bulb globe temperature" },
  { k:"pp1",  g:"Precip prob (%)",  l:"1 hr",  s:"", kind:"prob", win:1, ev:"pop", title:"Precipitation, 1 hour" },
  { k:"pp3",  g:"Precip prob (%)",  l:"3 hr",  s:"", kind:"prob", win:3, ev:"pop", title:"Precipitation, 3 hours" },
  { k:"pp6",  g:"Precip prob (%)",  l:"6 hr",  s:"", kind:"prob", win:6, ev:"pop", title:"Precipitation, 6 hours" },
  { k:"lt1",  g:"Lightning prob (%)", l:"1 hr", s:"", kind:"prob", win:1, ev:"tst", title:"Lightning, 1 hour" },
  { k:"lt3",  g:"Lightning prob (%)", l:"3 hr", s:"", kind:"prob", win:3, ev:"tst", title:"Lightning, 3 hours" },
  { k:"lt6",  g:"Lightning prob (%)", l:"6 hr", s:"", kind:"prob", win:6, ev:"tst", title:"Lightning, 6 hours" },
  { k:"s54",  g:"Winds (kt)", l:"54 ft",  s:"sust", kind:"num", unit:"kt", step:1, lo:0, title:"54 ft sustained wind", thr:[18,25,35,50] },
  { k:"g54",  g:"Winds (kt)", l:"54 ft",  s:"peak", kind:"num", unit:"kt", step:1, lo:0, title:"54 ft peak wind", thr:[25,35,50] },
  { k:"s200", g:"Winds (kt)", l:"200 ft", s:"sust", kind:"num", unit:"kt", step:1, lo:0, title:"200 ft sustained wind", thr:[18,25,35,50] },
  { k:"g200", g:"Winds (kt)", l:"200 ft", s:"peak", kind:"num", unit:"kt", step:1, lo:0, title:"200 ft peak wind", thr:[25,35,50] },
  { k:"dir",  g:"Winds (kt)", l:"Dir",    s:"54 ft", kind:"dir", unit:"° true", step:10, lo:0, hi:360, title:"Wind direction" },
  { k:"x18",  g:"Probability of exceeding, sfc to 200 ft (%)", l:">18 kt", s:"sust", kind:"prob", ex:"smax", op:">", v:18, title:"Sustained wind over 18 kt" },
  { k:"x25",  g:"Probability of exceeding, sfc to 200 ft (%)", l:">25 kt", s:"peak", kind:"prob", ex:"gmax", op:">", v:25, title:"Peak wind over 25 kt" },
  { k:"x35",  g:"Probability of exceeding, sfc to 200 ft (%)", l:">35 kt", s:"peak", kind:"prob", ex:"gmax", op:">", v:35, title:"Peak wind over 35 kt" },
  { k:"x50",  g:"Probability of exceeding, sfc to 200 ft (%)", l:">50 kt", s:"peak", kind:"prob", ex:"gmax", op:">", v:50, title:"Peak wind over 50 kt" },
  { k:"xhot", g:"Probability of exceeding, sfc to 200 ft (%)", l:">86°F",  s:"",     kind:"prob", ex:"tmax", op:">", v:"hot", title:"Temperature above hot threshold" },
  { k:"x40",  g:"Probability of exceeding, sfc to 200 ft (%)", l:"<40°F",  s:"",     kind:"prob", ex:"tmin", op:"<", v:40, title:"Temperature below 40°F" },
  { k:"x32",  g:"Probability of exceeding, sfc to 200 ft (%)", l:"<32°F",  s:"",     kind:"prob", ex:"tmin", op:"<", v:32, title:"Temperature below 32°F" },
  { k:"xvis", g:"Probability of exceeding, sfc to 200 ft (%)", l:"Vis <3 mi", s:"", kind:"prob", ex:"vmin", op:"<", v:4828, title:"Visibility below 3 miles" },
  { k:"sev",  g:"Severe potential", l:"Damaging wind, hail, tornado", s:"", kind:"sev", title:"Severe thunderstorm potential" },
];
const P = Object.fromEntries(PARAMS.map(p => [p.k, p]));
PARAMS.forEach(p => { if (p.kind === "prob") { p.unit = "%"; p.step = 1; p.lo = 0; p.hi = 100; } });

/* ---------- time helpers ---------- */
const _lp = new Intl.DateTimeFormat("en-US", { timeZone:TZ, hourCycle:"h23", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", weekday:"short" });
const _lpCache = new Map();
function lp(ms){
  let o = _lpCache.get(ms); if (o) return o;
  const q = {}; for (const x of _lp.formatToParts(new Date(ms))) q[x.type] = x.value;
  o = { y:+q.year, mo:+q.month, d:+q.day, h:(+q.hour)%24, mi:+q.minute, wd:q.weekday };
  if (_lpCache.size > 5000) _lpCache.clear();
  _lpCache.set(ms, o); return o;
}
function localMidnight(ms, addDays){
  const p = lp(ms);
  let g = Date.UTC(p.y, p.mo - 1, p.d + addDays, 5);
  for (let i = 0; i < 3; i++){ const q = lp(g); if (q.h === 0 && q.mi === 0) break; g -= (q.h * 60 + q.mi) * 60e3; if (q.h > 12) g += 24 * H; }
  return g;
}
function tzAbbr(ms){ const s = new Intl.DateTimeFormat("en-US",{timeZone:TZ,timeZoneName:"short"}).format(new Date(ms)); return s.split(" ").pop(); }
const pad2 = n => String(n).padStart(2, "0");
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const WEEK = { Sun:"Sunday", Mon:"Monday", Tue:"Tuesday", Wed:"Wednesday", Thu:"Thursday", Fri:"Friday", Sat:"Saturday" };
function hhmm(ms, zulu){ if (zulu){ const d = new Date(ms); return pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()); } const p = lp(ms); return pad2(p.h) + pad2(p.mi); }
function dayKey(ms, zulu){ if (zulu){ const d = new Date(ms); return d.getUTCFullYear()*10000 + (d.getUTCMonth()+1)*100 + d.getUTCDate(); } const p = lp(ms); return p.y*10000 + p.mo*100 + p.d; }
function dayLabel(ms, zulu){
  if (zulu){ const d = new Date(ms); return { wd: ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getUTCDay()], dt: d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] }; }
  const p = lp(ms); return { wd: WEEK[p.wd], dt: p.d + " " + MONTHS[p.mo - 1] };
}

/* ---------- rows: 1 h to 24 h, 3 h blocks to day 5, 6 h on days 6-7 ---------- */
function nextAligned(t, L){ let u = t + H; while (lp(u).h % L !== 0) u += H; return u; }
function buildRows(nowMs){
  const t0 = Math.floor(nowMs / H) * H;
  const day6 = localMidnight(t0, 5), day8 = localMidnight(t0, 7);
  const rows = []; let t = t0;
  while (t < t0 + 24 * H || lp(t).h % 3 !== 0){ rows.push({ a:t, b:t + H, len:1 }); t += H; }
  while (t < day6){ const b = Math.min(nextAligned(t, 3), day6); rows.push({ a:t, b, len:Math.round((b - t)/H) === 3 ? 3 : Math.round((b - t)/H) }); t = b; }
  while (t < day8){ const b = Math.min(nextAligned(t, 6), day8); rows.push({ a:t, b, len:Math.round((b - t)/H) }); t = b; }
  rows.forEach((r, i) => { r.i = i; r.key = r.a + "_" + r.len; r.blk = r.len === 1 ? 1 : r.len <= 3 ? 3 : 6; const mid = lp(r.a + (r.b - r.a)/2).h; r.daytime = r.len === 1 ? null : (mid >= 9 && mid <= 18); r.lh = lp(r.a).h; });
  return rows;
}

/* ---------- physics ---------- */
const f2c = f => (f - 32) * 5/9, c2f = c => c * 9/5 + 32;
function rhFrom(tF, tdF){ const t = f2c(tF), td = f2c(tdF); const es = Math.exp(17.625*t/(243.04+t)), e = Math.exp(17.625*td/(243.04+td)); return Math.max(1, Math.min(100, 100*e/es)); }
function wetBulbC(tC, rh){ return tC*Math.atan(0.151977*Math.sqrt(rh+8.313659)) + Math.atan(tC+rh) - Math.atan(rh-1.676331) + 0.00391838*Math.pow(rh,1.5)*Math.atan(0.023101*rh) - 4.686035; }
/* Outdoor WBGT estimate: natural wet bulb from psychrometric wet bulb plus a solar term,
   globe temperature from air temperature, shortwave and 2 m wind (m/s). */
function wbgtF(tF, tdF, sw, wsKt){
  if (tF == null || tdF == null) return null;
  const tC = f2c(tF), rh = rhFrom(tF, tdF), tw = wetBulbC(tC, rh);
  const S = Math.max(0, sw || 0), u = Math.max(0.5, (wsKt || 0) * 0.514 * 0.75);
  const tnwb = tw + 0.0021 * S, tg = tC + 0.0175 * S / (1 + 0.4 * u);
  return c2f(0.7*tnwb + 0.2*tg + 0.1*tC);
}
const Z54 = 16.46, Z200 = 60.96, Z0 = 0.03, ALPHA = 0.14;
function windAt(z, s10, s80){
  if (s10 == null) return null;
  if (s80 != null) return Math.max(0, s10 + (s80 - s10) * Math.log(z/10) / Math.log(8));
  return s10 * Math.pow(z/10, ALPHA);
}
function gustFactor(s10, g10){ if (s10 == null) return null; if (g10 == null || s10 < 0.5 || g10 < s10) return 1.3; return Math.min(2.5, g10 / s10); }
function peakAt(z, sz, gf10){ if (sz == null || gf10 == null) return null; return sz * (1 + (gf10 - 1) * Math.log(10/Z0) / Math.log(z/Z0)); }
function skyCat(pct){ if (pct == null) return null; for (const [c, a, b] of SKY) if (pct >= a && pct < b) return c; return "OVC"; }
const COMPASS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
function compass(d){ if (d == null) return ""; return COMPASS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16]; }
function parseDir(s){ s = String(s).trim().toUpperCase(); const i = COMPASS.indexOf(s); if (i >= 0) return i * 22.5; const n = parseFloat(s); return isFinite(n) ? ((n % 360) + 360) % 360 : null; }

/* ---------- weighted helpers ---------- */
function wmean(pairs){ let s = 0, w = 0; for (const [v, x] of pairs) if (v != null && isFinite(v)){ s += v*x; w += x; } return w > 0 ? s/w : null; }
function wquant(vals, wts, qs){
  const idx = vals.map((v, i) => i).filter(i => vals[i] != null).sort((a, b) => vals[a] - vals[b]);
  if (idx.length < 3) return null;
  let tot = 0; idx.forEach(i => tot += wts[i]); let c = 0; const mid = idx.map(i => { c += wts[i]; return (c - wts[i]/2)/tot; });
  return qs.map(q => { if (q <= mid[0]) return vals[idx[0]]; for (let j = 1; j < idx.length; j++) if (q <= mid[j]){ const f = (q - mid[j-1])/(mid[j] - mid[j-1]); return vals[idx[j-1]] + f*(vals[idx[j]] - vals[idx[j-1]]); } return vals[idx[idx.length-1]]; });
}

/* ---------- timeline + series ---------- */
function makeTimeline(nowMs){ const t0 = Math.floor(nowMs/H)*H - 6*H; const n = 8*24 + 12; return { t0, n, idx: ms => Math.round((ms - t0)/H) }; }
function fillGaps(arr, maxGap){
  let last = -1;
  for (let i = 0; i < arr.length; i++){
    if (arr[i] == null) continue;
    if (last >= 0 && i - last > 1 && i - last <= maxGap){ for (let j = last + 1; j < i; j++) arr[j] = arr[last] + (arr[i] - arr[last]) * (j - last)/(i - last); }
    last = i;
  }
  return arr;
}
function fillDirGaps(dir, spd, maxGap){
  const u = dir.map((d, i) => d == null ? null : -Math.sin(d*Math.PI/180) * Math.max(0.1, spd[i] || 1));
  const v = dir.map((d, i) => d == null ? null : -Math.cos(d*Math.PI/180) * Math.max(0.1, spd[i] || 1));
  fillGaps(u, maxGap); fillGaps(v, maxGap);
  return u.map((x, i) => x == null || v[i] == null ? null : (Math.atan2(-x, -v[i]) * 180/Math.PI + 360) % 360);
}
/* derive the height winds, WBGT etc. for one member (arrays on the timeline) */
function deriveMember(m, n){
  const z = () => new Array(n).fill(null);
  ["t","td","sky","s10","d10","g10","s80","d80","vis","sw","pr","pp","cl","cm","ch","slp","cig","lcb"].forEach(k => { if (!m[k]) m[k] = z(); });
  ["t","td","sky","s10","g10","s80","vis","sw","cl","cm","ch","slp","cig","lcb"].forEach(k => fillGaps(m[k], m.gap || 3));
  m.d10 = fillDirGaps(m.d10, m.s10, m.gap || 3);
  m.s54 = z(); m.g54 = z(); m.s200 = z(); m.g200 = z(); m.wbgt = z();
  for (let i = 0; i < n; i++){
    const s10 = m.s10[i]; if (s10 != null){
      const gf = gustFactor(s10, m.g10[i]);
      m.s54[i] = windAt(Z54, s10, m.s80[i]); m.s200[i] = windAt(Z200, s10, m.s80[i]);
      m.g54[i] = peakAt(Z54, m.s54[i], gf); m.g200[i] = peakAt(Z200, m.s200[i], gf);
    }
    m.wbgt[i] = wbgtF(m.t[i], m.td[i], m.sw[i], s10);
  }
  return m;
}

/* ---------- fetching ---------- */
const OM_VARS = "temperature_2m,dew_point_2m,cloud_cover,precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_80m,wind_direction_80m,visibility,shortwave_radiation,cloud_cover_low,cloud_cover_mid,cloud_cover_high,pressure_msl";
const OM_VARS_ENS = "temperature_2m,dew_point_2m,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_80m,wind_direction_80m,visibility,shortwave_radiation";
const OM_MIN = "temperature_2m,dew_point_2m,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,shortwave_radiation";
const VMAP = { cloud_cover_low:"cl", cloud_cover_mid:"cm", cloud_cover_high:"ch", pressure_msl:"slp", temperature_2m:"t", dew_point_2m:"td", cloud_cover:"sky", precipitation:"pr", precipitation_probability:"pp", wind_speed_10m:"s10", wind_direction_10m:"d10", wind_gusts_10m:"g10", wind_speed_80m:"s80", wind_direction_80m:"d80", visibility:"vis", shortwave_radiation:"sw" };

const VKEYS = Object.keys(VMAP).sort((a, b) => b.length - a.length);
async function getJSON(url, ms){
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms || 30000);
  try { const r = await fetch(url, { signal: ctl.signal, cache:"no-store" }); if (!r.ok){ const e = new Error("HTTP " + r.status); e.status = r.status; throw e; } return await r.json(); }
  finally { clearTimeout(tm); }
}
function omURL(base, model, vars){
  const lat = SITES.map(s => s.lat).join(","), lon = SITES.map(s => s.lon).join(",");
  return `${base}?latitude=${lat}&longitude=${lon}&hourly=${vars}&models=${model}&temperature_unit=fahrenheit&wind_speed_unit=kn&precipitation_unit=inch&timezone=GMT&timeformat=unixtime&forecast_days=8`;
}
/* returns per-site list of member objects, or throws */
async function fetchOM(src, ens, TL){
  const base = ens ? "https://ensemble-api.open-meteo.com/v1/ensemble" : "https://api.open-meteo.com/v1/forecast";
  let js;
  try { js = await getJSON(omURL(base, src.model, ens ? OM_VARS_ENS : OM_VARS), 45000); }
  catch (e){ if (e.status === 400) js = await getJSON(omURL(base, src.model, OM_MIN), 45000); else throw e; }
  const arr = Array.isArray(js) ? js : [js];
  return SITES.map((site, si) => {
    const hr = (arr[si] || {}).hourly || {}; const times = hr.time || [];
    const mem = new Map();
    for (const key of Object.keys(hr)){
      if (key === "time") continue;
      const base = VKEYS.find(vk => key === vk || key.startsWith(vk + "_"));
      if (!base) continue;
      const rest = key.slice(base.length);
      if (base === "precipitation" && rest.startsWith("_probability")) continue;
      const q = rest.match(/member(\d+)/); const mi = q ? +q[1] : 0;
      if (!mem.has(mi)) mem.set(mi, {});
      const out = new Array(TL.n).fill(null), vals = hr[key];
      for (let j = 0; j < times.length; j++){ const i = TL.idx(times[j]*1000); if (i >= 0 && i < TL.n && vals[j] != null) out[i] = vals[j]; }
      mem.get(mi)[VMAP[base]] = out;
    }
    const members = [...mem.values()].filter(m => m.t && m.t.some(v => v != null));
    members.forEach(m => { m.gap = ens ? 6 : 3; deriveMember(m, TL.n); });
    return members;
  });
}

/* IEM MOS: prefer a same-origin mirror written by the workflow (data/mos/<MODEL>.json), then IEM */
async function fetchMOS(src, TL){
  let js = null, from = "";
  try { js = await getJSON(`data/mos/${src.model}.json?ts=${Date.now()}`, 8000); from = "mirror"; } catch (e) { js = null; }
  if (!js || !rowsOf(js).length){
    const st = STATIONS.map(s => "station=" + s).join("&");
    js = await getJSON(`https://mesonet.agron.iastate.edu/api/1/mos.json?${st}&model=${src.model}`, 30000); from = "IEM";
  }
  const rows = rowsOf(js);
  const byStn = {};
  for (const r of rows){ const k = String(pick(r, ["station"]) || "").toUpperCase(); (byStn[k] = byStn[k] || []).push(r); }
  const out = {};
  for (const stn of STATIONS){
    const rs = byStn[stn] || byStn[stn.slice(1)] || [];
    if (!rs.length){ out[stn] = null; continue; }
    out[stn] = parseMOS(rs, src, TL); out[stn].from = from;
  }
  return out;
}
function rowsOf(js){
  if (!js) return [];
  if (Array.isArray(js)) return js;
  if (Array.isArray(js.data)) return js.data;
  if (js.data && typeof js.data === "object"){ const k = Object.keys(js.data); const n = (js.data[k[0]] || []).length; const o = []; for (let i = 0; i < n; i++){ const r = {}; k.forEach(x => r[x] = js.data[x][i]); o.push(r); } return o; }
  return [];
}
function pick(r, keys){ for (const k of keys){ for (const rk of Object.keys(r)) if (rk.toLowerCase() === k){ const v = r[rk]; if (v !== null && v !== undefined && v !== "" && v !== "None") return v; } } return null; }
function pnum(r, keys){ const v = pick(r, keys); if (v == null) return null; if (typeof v === "number") return v; const m = String(v).match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; }
function ptime(v){ if (v == null) return null; if (typeof v === "number") return v > 1e12 ? v : v * 1000; let s = String(v).trim().replace(" ", "T"); if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += "Z"; const t = Date.parse(s); return isFinite(t) ? t : null; }
const CLD = { CL:0, FW:19, SC:44, BK:75, OV:100, CLR:0, FEW:19, SCT:44, BKN:75, OVC:100 };
function parseMOS(rs, src, TL){
  const m = { t:[], td:[], sky:[], s10:[], d10:[], g10:[], vis:[], cig:[], lcb:[] };
  Object.keys(m).forEach(k => m[k] = new Array(TL.n).fill(null));
  const iv = { pop:[], tst:[] };
  let run = null;
  const visv = rs.map(r => pnum(r, ["vis"])).filter(v => v != null);
  const visTenths = visv.length && Math.max(...visv) > 7;
  for (const r of rs){
    const ft = ptime(pick(r, ["ftime","valid","fcst_time"])); if (ft == null) continue;
    const rt = ptime(pick(r, ["runtime","model_runtime"])); if (rt && (!run || rt > run)) run = rt;
    const i = TL.idx(ft); const inR = i >= 0 && i < TL.n;
    const tmp = pnum(r, ["tmp"]), dpt = pnum(r, ["dpt"]);
    if (inR){
      if (tmp != null && tmp > -60 && tmp < 130) m.t[i] = tmp;
      if (dpt != null && dpt > -60 && dpt < 100) m.td[i] = dpt;
      const cl = pick(r, ["cld"]); const skp = pnum(r, ["sky"]);
      if (cl != null && CLD[String(cl).toUpperCase()] != null) m.sky[i] = CLD[String(cl).toUpperCase()];
      else if (skp != null && skp >= 0 && skp <= 100) m.sky[i] = skp;
      const wd = pnum(r, ["wdr"]), ws = pnum(r, ["wsp"]), gs = pnum(r, ["gst","wgs"]);
      /* IEM stores wdr already multiplied by 10 (true degrees) */
      if (ws != null && ws >= 0 && ws < 150){ m.s10[i] = ws; if (wd != null) m.d10[i] = wd % 360; if (gs != null && gs >= ws) m.g10[i] = gs; }
      const vv = pnum(r, ["vis"]);
      if (vv != null){ m.vis[i] = visTenths ? vv * 160.934 : [null, 400, 1200, 2400, 4000, 6400, 9600, 12000][Math.round(vv)] ?? null; }
      /* ceiling / lowest cloud base in ft: NBM text in hundreds of ft (888 = unlimited), LAMP and MOS as categories 1-8 */
      const cg = pnum(r, ["cig"]), lb = pnum(r, ["lcb"]);
      if (cg != null){
        if (src.model === "NBS" || src.model === "NBE") m.cig[i] = cg >= 800 ? 30000 : cg*100;
        else m.cig[i] = [null, 100, 300, 700, 1500, 2500, 4500, 9000, 30000][Math.round(cg)] ?? null;
      }
      if (lb != null && (src.model === "NBS" || src.model === "NBE")) m.lcb[i] = lb >= 800 ? 30000 : lb*100;
    }
    const addI = (kind, keys, hrs) => { const p = pnum(r, keys); if (p != null && p >= 0 && p <= 100) iv[kind].push({ a: ft - hrs*H, b: ft, p: p/100 }); };
    if (src.model === "LAV"){ addI("pop", ["ppo"], 1); addI("tst", ["lp2","tp2","tc2"], 2); }
    if (src.model === "NBS"){ addI("pop", ["p06"], 6); addI("tst", ["t03"], 3); }
    if (src.model === "NBE"){ addI("pop", ["p12"], 12); addI("tst", ["t12"], 12); }
    if (src.model === "GFS" || src.model === "NAM"){ addI("pop", ["p06"], 6); addI("tst", ["t06_1","t06"], 6); }
    if (src.model === "GFSX"){ addI("pop", ["p12"], 12); addI("tst", ["t12_1","t12"], 12); }
  }
  m.gap = src.model === "GFSX" || src.model === "NBE" ? 12 : 3;
  deriveMember(m, TL.n);
  return { members:[m], iv, run };
}

/* High-res pipeline output: RRFS, REFS members, HREF / REFS calibrated thunder */
async function fetchPipeline(TL){
  const js = await getJSON(`data/hires.json?ts=${Date.now()}`, 15000);
  const out = {};
  for (const src of js.sources || []){
    const per = {};
    for (const s of SITES){
      const st = (src.sites || {})[s.id]; if (!st) continue;
      const members = (st.members || []).map(mm => {
        const m = {};
        for (const k in mm){ const arr = new Array(TL.n).fill(null); mm[k].forEach((v, j) => { const i = TL.idx(src.t0 + j*H); if (i >= 0 && i < TL.n && v != null) arr[i] = v; }); m[k] = arr; }
        m.gap = src.gap || 3; return deriveMember(m, TL.n);
      }).filter(m => m.t.some(v => v != null));
      const iv = st.iv ? { tst: st.iv.tst || [], tst4: st.iv.tst4 || [] } : null;
      if (members.length || (iv && iv.tst.length)) per[s.id] = { members, iv };
    }
    out[src.id] = { run: Date.parse(src.run), per, n: Math.max(0, ...Object.values(per).map(x => x.members.length)) };
  }
  return out;
}

/* SPC Day 1-3 categorical outlook (point in polygon). Optional; fails quietly. */
async function fetchSPC(){
  const out = [];
  for (const d of [1,2,3]){
    try {
      let js = null;
      try { js = await getJSON(`data/mos/spc_day${d}.json?ts=${Date.now()}`, 8000); } catch (e) { js = null; }
      if (!js || !js.features) js = await getJSON(`https://www.spc.noaa.gov/products/outlook/day${d}otlk_cat.nolyr.geojson`, 15000);
      for (const f of js.features || []){
        const pr = f.properties || {}; const lab = String(pr.LABEL || pr.label || "").toUpperCase();
        const cat = { MRGL:"MRGL", SLGT:"SLGT", ENH:"ENH", MDT:"MDT", HIGH:"HIGH" }[lab]; if (!cat) continue;
        const pt = s => { s = String(s || ""); return Date.UTC(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8), +s.slice(8,10), +s.slice(10,12)); };
        out.push({ cat, a: pt(pr.VALID), b: pt(pr.EXPIRE), geom: f.geometry });
      }
    } catch (e) { /* not reachable from this browser */ }
  }
  return out;
}
function inRing(x, y, ring){ let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++){ const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi)*(y - yi)/(yj - yi) + xi)) c = !c; } return c; }
function inGeom(lon, lat, g){
  if (!g) return false;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.some(p => inRing(lon, lat, p[0]) && !p.slice(1).some(h => inRing(lon, lat, h)));
}

/* ============================================================
   Guidance engine
   ============================================================ */
const ROWMETRIC = {
  t:"t*", td:"mean", wbgt:"max", sky:"mean", s54:"max", g54:"max", s200:"max", g200:"max",
};
/* per-member block metrics for one row */
function blockOf(m, row, TL){
  const i0 = TL.idx(row.a), i1 = TL.idx(row.b);
  const rng = []; for (let i = i0; i < i1; i++) if (i >= 0 && i < TL.n) rng.push(i);
  if (!rng.length) return null;
  const agg = (arr, how) => { let r = null, s = 0, n = 0; for (const i of rng){ const v = arr[i]; if (v == null) continue; if (how === "max") r = r == null ? v : Math.max(r, v); else if (how === "min") r = r == null ? v : Math.min(r, v); else { s += v; n++; } } return how === "mean" ? (n ? s/n : null) : r; };
  const o = {};
  if (row.len === 1){ const i = rng[0]; ["t","td","wbgt","sky","s54","g54","s200","g200"].forEach(k => o[k] = m[k][i]); o.tmax = o.tmin = m.t[i]; o.vmin = m.vis[i]; }
  else {
    o.tmax = agg(m.t, "max"); o.tmin = agg(m.t, "min"); o.t = row.daytime ? o.tmax : o.tmin;
    o.td = agg(m.td, "mean"); o.wbgt = agg(m.wbgt, "max"); o.sky = agg(m.sky, "mean");
    ["s54","g54","s200","g200"].forEach(k => o[k] = agg(m[k], "max")); o.vmin = agg(m.vis, "min");
  }
  let u = 0, v = 0, nn = 0; for (const i of (row.len === 1 ? [rng[0]] : rng)){ const d = m.d10[i], s = m.s54[i]; if (d == null || s == null) continue; const w = Math.max(0.3, s); u += -Math.sin(d*Math.PI/180)*w; v += -Math.cos(d*Math.PI/180)*w; nn++; }
  o.du = nn ? u/nn : null; o.dv = nn ? v/nn : null;
  o.smax = o.s54 == null && o.s200 == null ? null : Math.max(o.s54 ?? -1, o.s200 ?? -1);
  o.gmax = o.g54 == null && o.g200 == null ? null : Math.max(o.g54 ?? -1, o.g200 ?? -1);
  return o;
}
/* fraction of a source's members with precip >= 0.01 in [A,B) (precip stamps are end-of-hour) */
function memberPrecip(m, A, B, TL){
  let any = false, sum = 0;
  for (let t = A + H; t <= B; t += H){
    const i = TL.idx(t); if (i < 0 || i >= TL.n) continue; const v = m.pr[i]; if (v == null) continue;
    const k = (m.pacc && m.pacc[i]) || 1; if (t - k*H < A) return null;   /* accumulation reaches outside the window */
    any = true; sum += v;
  }
  return any ? (sum >= 0.0095 ? 1 : 0) : null;
}
function nbmPop(m, A, B, TL){
  const ps = []; for (let t = A + H; t <= B; t += H){ const i = TL.idx(t); if (i >= 0 && i < TL.n && m.pp[i] != null) ps.push(m.pp[i]/100); }
  if (!ps.length) return null;
  const mx = Math.max(...ps), ind = 1 - ps.reduce((a, p) => a*(1 - p), 1);
  return mx + 0.5*(ind - mx);
}
/* rolling fixed-length periods (calibrated thunder 4 h): tile [A,B) from A without overlap */
function tiledProb(list, A, B, L){
  if (!list || !list.length) return null;
  const byStart = new Map(list.map(it => [it.a, it]));
  let t = A, q = 1;
  while (t < B){
    const seg = Math.min(L, B - t);
    const it = byStart.get(t) || list.find(x => x.a <= t && x.b >= t + seg);
    if (!it) return null;
    q *= Math.pow(1 - Math.min(0.999, it.p), seg/(it.b - it.a)); t += seg;
  }
  return 1 - q;
}
function intervalProb(list, A, B){
  if (!list || !list.length) return null;
  let cover = 0, q = 1;
  for (const it of list){
    const ov = Math.min(B, it.b) - Math.max(A, it.a); if (ov <= 0) continue;
    const L = it.b - it.a; cover += ov; q *= Math.pow(1 - Math.min(0.999, it.p), ov / L);
  }
  if (cover < (B - A) * 0.99) return null;
  return 1 - q;
}

class SiteGuidance {
  constructor(site, TL, rows){ this.site = site; this.TL = TL; this.rows = rows; this.src = []; this.sev = []; }
  addSource(def, members, extra){
    const s = { def, members, iv: extra && extra.iv, run: extra && extra.run, blocks: members.map(m => this.rows.map(r => blockOf(m, r, this.TL))), win: new Map() };
    this.src.push(s); return s;
  }
  /* probability of event (pop/tst) in window [A,B) from one source, memoized */
  srcWin(s, ev, A, B){
    const key = ev + A + "_" + B; if (s.win.has(key)) return s.win.get(key);
    let p = null;
    if (s.iv){
      if (ev === "tst" && s.iv.tst4 && s.iv.tst4.length && B - A >= 3*H) p = tiledProb(s.iv.tst4, A, B, 4*H);
      if (p == null) p = intervalProb(s.iv[ev], A, B);
    }
    else if (ev === "pop"){
      if (s.def.id === "nbm" && s.members[0] && s.members[0].pp.some(v => v != null)) p = nbmPop(s.members[0], A, B, this.TL);
      else { let h = 0, n = 0; for (const m of s.members){ const o = memberPrecip(m, A, B, this.TL); if (o == null) continue; h += o; n++; } p = n ? h/n : null; }
    }
    s.win.set(key, p); return p;
  }
}

/* aggregate everything for the current source selection; returns {val:{k:[]}, srcv:{k:{id:[]}}, band:{k:[[lo,hi]]}} */
function aggregate(G, prefs){
  const rows = G.rows, on = G.src.filter(s => prefs.enabled[s.def.id] !== false && (prefs.weight[s.def.id] ?? s.def.w ?? 1) > 0);
  const W = s => prefs.weight[s.def.id] ?? s.def.w ?? 1;
  const val = {}, srcv = {}, band = {}, mem = {};
  const scal = ["t","td","wbgt","sky","s54","g54","s200","g200"];
  for (const k of [...scal, "dir"]){ val[k] = []; srcv[k] = {}; band[k] = []; }
  for (const k of ["tmax","tmin","smax","gmax","vmin"]) mem[k] = [];
  rows.forEach((r, ri) => {
    for (const k of scal){
      const pairs = [], vals = [], wts = [];
      for (const s of on){
        const bs = s.blocks.map(b => b[ri]).filter(b => b && b[k] != null);
        if (!bs.length) continue;
        const mean = bs.reduce((a, b) => a + b[k], 0)/bs.length;
        (srcv[k][s.def.id] = srcv[k][s.def.id] || [])[ri] = mean;
        pairs.push([mean, W(s)]);
        bs.forEach(b => { vals.push(b[k]); wts.push(W(s)/bs.length); });
      }
      val[k][ri] = wmean(pairs);
      band[k][ri] = vals.length >= 6 ? wquant(vals, wts, [0.1, 0.9]) : null;
    }
    let U = 0, V = 0, ww = 0;
    for (const s of on){
      const bs = s.blocks.map(b => b[ri]).filter(b => b && b.du != null); if (!bs.length) continue;
      const u = bs.reduce((a, b) => a + b.du, 0)/bs.length, v = bs.reduce((a, b) => a + b.dv, 0)/bs.length;
      (srcv.dir[s.def.id] = srcv.dir[s.def.id] || [])[ri] = (Math.atan2(-u, -v)*180/Math.PI + 360) % 360;
      U += u*W(s); V += v*W(s); ww += W(s);
    }
    val.dir[ri] = ww ? (Math.atan2(-U, -V)*180/Math.PI + 360) % 360 : null;
    for (const k of Object.keys(mem)){
      const list = [];
      for (const s of on){ const bs = s.blocks.map(b => b[ri]).filter(b => b && b[k] != null); bs.forEach(b => list.push([b[k], W(s)/bs.length, s.def.id])); }
      mem[k][ri] = list;
    }
  });
  /* window probabilities */
  const winP = (ev, A, B, per) => {
    const pairs = [];
    for (const s of on){ const p = G.srcWin(s, ev, A, B); if (p == null) continue; pairs.push([p, W(s)]); if (per) per[s.def.id] = p; }
    return wmean(pairs);
  };
  for (const pk of ["pp1","pp3","pp6","lt1","lt3","lt6"]){
    const p = P[pk]; val[pk] = []; srcv[pk] = {};
    rows.forEach((r, ri) => {
      const cell = probCell(r, p.win);
      if (!cell){ val[pk][ri] = undefined; return; }
      const per = {};
      if (cell.mode === "win"){ const v = winP(p.ev, cell.A, cell.B, per); val[pk][ri] = v == null ? null : v*100; }
      else {
        let best = null; const L = p.win*H;
        for (let A = r.a; A + L <= r.b; A += L){ const pp = {}; const v = winP(p.ev, A, A + L, pp); if (v != null && (best == null || v > best)) best = v; for (const id in pp) per[id] = Math.max(per[id] ?? 0, pp[id]); }
        val[pk][ri] = best == null ? null : best*100;
      }
      for (const id in per) (srcv[pk][id] = srcv[pk][id] || [])[ri] = per[id]*100;
    });
  }
  /* exceedance probabilities (members, with optional shift by the forecaster's edits) */
  for (const pk of ["x18","x25","x35","x50","xhot","x40","x32","xvis"]){
    val[pk] = []; srcv[pk] = {};
  }
  G.mem = mem; G.on = on;
  /* severe: SPC outlook */
  val.sev = rows.map(r => {
    let best = "-";
    for (const o of G.sev){ if (r.a < o.b && r.b > o.a && inGeom(G.site.lon, G.site.lat, o.geom) && SEV.indexOf(o.cat) > SEV.indexOf(best)) best = o.cat; }
    return best;
  });
  return { val, srcv, band };
}
/* which window a precip/lightning cell represents */
/* which window a precip/lightning cell represents:
   "win" = the probability for [A,B); "max" = highest 1 h (or 3 h) period inside a longer block;
   null = covered by an earlier cell's window, or before the first aligned window */
function probCell(r, win){
  if (win === 1) return r.len === 1 ? { mode:"win", A:r.a, B:r.b } : { mode:"max" };
  if (r.len === win) return { mode:"win", A:r.a, B:r.b };
  if (r.len > win) return { mode:"max" };
  return r.lh % win === 0 ? { mode:"win", A:r.a, B:r.a + win*H } : null;
}
/* exceedance probability for one row given a delta shift */
function exceed(G, pk, ri, delta, hot){
  const p = P[pk]; const list = G.mem[p.ex][ri]; if (!list || !list.length) return { v:null, per:{} };
  const thr = p.v === "hot" ? hot : p.v;
  const bySrc = {};
  for (const [x, w, id] of list){ const y = x + (p.ex === "vmin" ? 0 : delta); const hit = p.op === ">" ? y > thr : y < thr; const o = bySrc[id] = bySrc[id] || { h:0, n:0, w:0 }; o.h += hit ? w : 0; o.w += w; }
  let s = 0, w = 0; const per = {};
  for (const id in bySrc){ const o = bySrc[id]; per[id] = 100*o.h/o.w; s += o.h; w += o.w; }
  return { v: w ? 100*s/w : null, per };
}
