"use strict";
/* where the mirrored data lives: this site, or the GitHub Pages copy when the tools run from a file */
const DATA_BASE = (typeof window !== "undefined" && window.DATA_BASE) || "";
const LOGO_SRC = (typeof window !== "undefined" && window.LOGO_SRC) || "45ws-logo.png";
const SEAL_SRC = (typeof window !== "undefined" && window.SEAL_SRC) || "ussf-seal.png";
/* ============================================================
   Daily Planning Forecast — KSC / CCSFS / Patrick SFB
   Guidance: Open-Meteo deterministic + ensemble models, IEM MOS
   (LAMP, GFS, GFS-X, NBM text). Everything runs in the page.
   ============================================================ */
/* local time: Eastern for the Cape tools; the personal page uses its location's time zone */
const TZ = (() => { try { if (typeof window !== "undefined" && window.PAGE === "personal"){ const p = JSON.parse(localStorage.getItem("persfx:v1:prefs") || "{}"); return (p.exp && p.exp.tz) || "America/New_York"; } } catch (e) { /* fall back */ } return "America/New_York"; })();
const H = 3600e3;
const SITES = [
  { id:"ksc-inland", name:"KSC Inland",      point:"SLF",    stn:"KTTS", lat:28.6150, lon:-80.6945, hot:86 },
  { id:"ksc-pads",   name:"KSC Launch Pads", point:"LC-39B", stn:"KTTS", lat:28.6272, lon:-80.6208, hot:86 },
  { id:"cape-inland",name:"Cape Inland",     point:"KXMR",   stn:"KXMR", lat:28.4686, lon:-80.5667, hot:86 },
  { id:"cape-pad37", name:"Cape Launch Pads", point:"SLC-37", stn:"KXMR", lat:28.5314, lon:-80.5650, hot:86 },
  { id:"patrick",    name:"Patrick SFB",     point:"KCOF",   stn:"KCOF", lat:28.2349, lon:-80.6101, hot:90 },
];
const STATIONS = [...new Set(SITES.map(s => s.stn))];
/* MOS stations for whatever points the page is using (the exposure page swaps SITES) */
const stationsNow = () => [...new Set(SITES.map(s => s.stn).filter(Boolean))];
/* heights (ft) that get sustained and peak winds; the exposure page sets its own */
const HEIGHTS = [54, 200];
const hkeys = () => HEIGHTS.flatMap(ft => ["s" + ft, "g" + ft]);
/* points in hires.json (pipeline/planning_hires.py); other points use the nearest within 15 km */
const PIPE_POINTS = {
  "ksc-inland":[28.6150,-80.6945], "ksc-pads":[28.6272,-80.6208], "cape-inland":[28.4686,-80.5667], "cape-pad37":[28.5314,-80.5650], "patrick":[28.2349,-80.6101],
  "lc39a":[28.6083,-80.6041], "slc40":[28.5620,-80.5772], "slc41":[28.5833,-80.5830], "lc36":[28.4710,-80.5378],
};
const kmBetween = (a, b, c, d) => { const R = 6371, x = (d - b)*Math.PI/180*Math.cos((a + c)/2*Math.PI/180), y = (c - a)*Math.PI/180; return R*Math.hypot(x, y); };

const FAMILIES = {
  hires: { label:"High resolution", color:"var(--hires)" },
  blend: { label:"Blend",           color:"var(--blend)" },
  global:{ label:"Global",          color:"var(--global)" },
  ens:   { label:"Ensembles",       color:"var(--ens)" },
  mos:   { label:"MOS and LAMP",    color:"var(--mos)" },
  ct:    { label:"Calibrated thunder", color:"var(--ct)" },
  nws:   { label:"NWS forecast",    color:"var(--blend)" },
};
/* the NWS forecast (NDFD grids from api.weather.gov, the Melbourne office's forecast) as one member */
const NDFD = { id:"ndfd", name:"NWS Forecast", fam:"nws" };
const OM_DET = [
  { id:"hrrr", name:"HRRR",       model:"ncep_hrrr_conus",               fam:"hires" },
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
  { id:"mex", name:"GFS MOS extended",model:"GFSX", fam:"mos" },
  { id:"nbs", name:"NBM text",        model:"NBS",  fam:"mos" },
  { id:"nbe", name:"NBM text extended",model:"NBE", fam:"mos" },
  /* ECMWF IFS MOS (N. Luchetti, nluchetti1.github.io/ecmwf-mos): ridge-regression temperatures, dew points and
     winds, logistic 6/12-hour precipitation and thunder chances; cloud and wind direction are raw IFS */
  { id:"ecm", name:"ECMWF MOS",       model:"ECM",  fam:"mos" },
];
/* written by pipeline/planning_hires.py into data/hires.json */
const PIPE = [
  { id:"rrfs",   name:"RRFS",                    fam:"hires" },
  { id:"refsm",  name:"REFS members",            fam:"hires" },
  /* the last six hourly runs as age-weighted members (newest 1, then ×0.8 per hour older) */
  { id:"hrrrtl", name:"HRRR time-lagged",        fam:"hires" },
  { id:"rrfstl", name:"RRFS time-lagged",        fam:"hires" },
  { id:"refsct", name:"REFS calibrated thunder", fam:"ct", w:2 },
];
/* HREF, the NAM and NAM MOS were retired by NCEP on 3 November 2026 and are no longer sources */
const ALL_SOURCES = [NDFD, OM_DET[0], PIPE[2], PIPE[0], PIPE[3], PIPE[1], ...OM_DET.slice(1), ...OM_ENS, ...MOS, PIPE[4]];

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
  { k:"qpf",  g:"Rainfall (in)",    l:"QPF",   s:"amount", kind:"num", unit:"in", step:0.01, lo:0, title:"Rainfall amount over the row (QPF)" },
  { k:"lt1",  g:"Lightning prob (%)", l:"1 hr", s:"", kind:"prob", win:1, ev:"tst", title:"Lightning, 1 hour" },
  { k:"lt3",  g:"Lightning prob (%)", l:"3 hr", s:"", kind:"prob", win:3, ev:"tst", title:"Lightning, 3 hours" },
  { k:"lt6",  g:"Lightning prob (%)", l:"6 hr", s:"", kind:"prob", win:6, ev:"tst", title:"Lightning, 6 hours" },
  { k:"s54",  g:"Winds (kt)", l:"54 ft",  s:"sust", kind:"num", unit:"kt", step:1, lo:0, title:"54 ft sustained wind", thr:[18,25,35,50] },
  { k:"g54",  g:"Winds (kt)", l:"54 ft",  s:"peak", kind:"num", unit:"kt", step:1, lo:0, title:"54 ft peak wind", thr:[25,35,50], peakOf:"s54" },
  { k:"s200", g:"Winds (kt)", l:"200 ft", s:"sust", kind:"num", unit:"kt", step:1, lo:0, title:"200 ft sustained wind", thr:[18,25,35,50] },
  { k:"g200", g:"Winds (kt)", l:"200 ft", s:"peak", kind:"num", unit:"kt", step:1, lo:0, title:"200 ft peak wind", thr:[25,35,50], peakOf:"s200" },
  { k:"dir",  g:"Winds (kt)", l:"Dir",    s:"54 ft", kind:"dir", unit:"° true", step:10, lo:0, hi:360, title:"Wind direction" },
  { k:"x18",  g:"Probability of exceeding, sfc to 200 ft (%)", l:">18 kt", s:"sust", kind:"prob", ex:"smax", dep:["s54","s200"], op:">", v:18, title:"Sustained wind over 18 kt" },
  { k:"x25",  g:"Probability of exceeding, sfc to 200 ft (%)", l:">25 kt", s:"peak", kind:"prob", ex:"gmax", dep:["g54","g200"], op:">", v:25, title:"Peak wind over 25 kt" },
  { k:"x35",  g:"Probability of exceeding, sfc to 200 ft (%)", l:">35 kt", s:"peak", kind:"prob", ex:"gmax", dep:["g54","g200"], op:">", v:35, title:"Peak wind over 35 kt" },
  { k:"x50",  g:"Probability of exceeding, sfc to 200 ft (%)", l:">50 kt", s:"peak", kind:"prob", ex:"gmax", dep:["g54","g200"], op:">", v:50, title:"Peak wind over 50 kt" },
  { k:"xhot", g:"Probability of exceeding, sfc to 200 ft (%)", l:">86°F",  s:"",     kind:"prob", ex:"tmax", dep:["t"], op:">", v:"hot", title:"Temperature above hot threshold" },
  { k:"x40",  g:"Probability of exceeding, sfc to 200 ft (%)", l:"<40°F",  s:"",     kind:"prob", ex:"tmin", dep:["t"], op:"<", v:40, title:"Temperature below 40°F" },
  { k:"x32",  g:"Probability of exceeding, sfc to 200 ft (%)", l:"<32°F",  s:"",     kind:"prob", ex:"tmin", dep:["t"], op:"<", v:32, title:"Temperature below 32°F" },
  { k:"xvis", g:"Probability of exceeding, sfc to 200 ft (%)", l:"Vis <3 mi", s:"", kind:"prob", ex:"vmin", op:"<", v:4828, title:"Visibility below 3 miles" },
  { k:"sev",  g:"Severe potential", l:"Damaging wind, hail, tornado", s:"", kind:"sev", title:"Severe thunderstorm potential" },
  { k:"hailp", g:"Severe potential", l:"Hail", s:"SPC %", kind:"num", unit:"%", step:1, lo:0, hi:100, title:"SPC hail probability: the chance of hail 1 inch or larger within 25 mi of the point (Days 1-2)" },
  { k:"ero",  g:"Excessive rainfall", l:"WPC outlook", s:"", kind:"sev", title:"WPC Excessive Rainfall Outlook (chance rain exceeds flash flood guidance within 25 mi)" },
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
  return finishRows(rows);
}
function finishRows(rows){
  rows.forEach((r, i) => { r.i = i; r.key = r.a + "_" + r.len; r.blk = r.len === 1 ? 1 : r.len <= 3 ? 3 : 6; const mid = lp(r.a + (r.b - r.a)/2).h; r.daytime = r.len === 1 ? null : (mid >= 9 && mid <= 18); r.lh = lp(r.a).h; });
  return rows;
}
/* exposure forecasts: hourly for the first hourlyH hours (Infinity = all), then 3-hour blocks to the end */
function buildRowsRange(startMs, endMs, hourlyH){
  const rows = []; let t = Math.floor(startMs/H)*H; const hEnd = t + (isFinite(hourlyH) ? hourlyH : 1e6)*H;
  while (t < endMs && (t < hEnd || lp(t).h % 3 !== 0)){ rows.push({ a:t, b:t + H, len:1 }); t += H; }
  while (t < endMs){ const b = Math.min(nextAligned(t, 3), endMs); rows.push({ a:t, b, len:Math.max(1, Math.round((b - t)/H)) }); t = b; }
  return finishRows(rows);
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
/* the timeline starts 30 h back so recent model values can be checked against observations */
let LAST_TL = null;
function makeTimeline(nowMs){ const t0 = Math.floor(nowMs/H)*H - 30*H; const n = 8*24 + 36; return (LAST_TL = { t0, n, idx: ms => Math.round((ms - t0)/H) }); }
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
  m.wbgt = z();
  for (let i = 0; i < n; i++) m.wbgt[i] = wbgtF(m.t[i], m.td[i], m.sw[i], m.s10[i]);
  deriveHeights(m, n, true);
  if (FIRE) deriveFire(m, n);
  else if (RHROW){ m.rh = new Array(n).fill(null); for (let i = 0; i < n; i++) if (m.t[i] != null && m.td[i] != null) m.rh[i] = rhFrom(m.t[i], m.td[i]); }
  return m;
}
/* sustained and peak wind at every height in HEIGHTS (ft) */
function deriveHeights(m, n, force){
  for (const ft of HEIGHTS){
    const sk = "s" + ft, gk = "g" + ft; if (!force && m[sk]) continue;
    const zm = ft*0.3048, S = new Array(n).fill(null), G = new Array(n).fill(null);
    for (let i = 0; i < n; i++){ const s10 = m.s10[i]; if (s10 == null) continue; S[i] = windAt(zm, s10, m.s80[i]); G[i] = peakAt(zm, S[i], gustFactor(s10, m.g10[i])); }
    m[sk] = S; m[gk] = G;
  }
  return m;
}

/* ---------- fetching ---------- */
const OM_VARS = "temperature_2m,dew_point_2m,cloud_cover,precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_80m,wind_direction_80m,visibility,shortwave_radiation,cloud_cover_low,cloud_cover_mid,cloud_cover_high,pressure_msl";
const OM_VARS_ENS = "temperature_2m,dew_point_2m,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_80m,wind_direction_80m,visibility,shortwave_radiation";
const OM_MIN = "temperature_2m,dew_point_2m,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,shortwave_radiation";
const VMAP = { cloud_cover_low:"cl", cloud_cover_mid:"cm", cloud_cover_high:"ch", pressure_msl:"slp", temperature_2m:"t", dew_point_2m:"td", cloud_cover:"sky", precipitation:"pr", precipitation_probability:"pp", wind_speed_10m:"s10", wind_direction_10m:"d10", wind_gusts_10m:"g10", wind_speed_80m:"s80", wind_direction_80m:"d80", visibility:"vis", shortwave_radiation:"sw" };

/* ---------- fire weather (burn page) ----------
   Mixing height from the models' boundary layer height; transport wind as the mean wind through the
   mixed layer from the pressure levels; Haines (low elevation, 950-850 hPa); ventilation, a
   dispersion index and LVORI as estimates from those. */
const FIRE = typeof window !== "undefined" && window.PAGE === "burn";
/* the personal forecast page (any point): relative humidity and, when asked, waves and sea state */
const PERS = typeof window !== "undefined" && window.PAGE === "personal";
const MARINE_KEYS = ["wvh", "swh", "wvp", "wvd", "sst"];
/* pages that carry relative humidity as its own row: personal, and the LMEF (RH in its edit table) */
const RHROW = PERS || (typeof window !== "undefined" && window.PAGE === "lmef");
const PLEV = [975, 950, 925, 900, 850, 800];
/* the inversion uses the temperature profile from the surface through 700 hPa */
const INV_LEV = [1000, 975, 950, 925, 900, 850, 800, 700];
const FIRE_VARS = ["boundary_layer_height", ...INV_LEV.map(l => `temperature_${l}hPa`), "geopotential_height_1000hPa", "geopotential_height_700hPa", "relative_humidity_950hPa", "relative_humidity_850hPa",
  ...PLEV.flatMap(p => [`wind_speed_${p}hPa`, `wind_direction_${p}hPa`, `geopotential_height_${p}hPa`])].join(",");
Object.assign(VMAP, { boundary_layer_height:"blh", relative_humidity_950hPa:"rh950", relative_humidity_850hPa:"rh850", geopotential_height_1000hPa:"z1000", geopotential_height_700hPa:"z700" },
  ...INV_LEV.map(l => ({ [`temperature_${l}hPa`]: "t" + l })),
  ...PLEV.map(p => ({ [`wind_speed_${p}hPa`]: "ws" + p, [`wind_direction_${p}hPa`]: "wd" + p, [`geopotential_height_${p}hPa`]: "z" + p })));
const FIRE_KEYS = ["rh","mixh","tw","vr","di","lvori","invh","invlow"];
const fToC = f => (f - 32)*5/9;
function deriveFire(m, n){
  const z = () => new Array(n).fill(null);
  FIRE_KEYS.forEach(k => m[k] = z()); m.twd = z(); m.haines = z();
  for (let i = 0; i < n; i++){
    const T = m.t[i], Td = m.td[i];
    if (T != null && Td != null) m.rh[i] = rhFrom(T, Td);
    const blh = m.blh ? m.blh[i] : null;
    if (blh != null) m.mixh[i] = Math.max(0, blh*3.28084);
    /* transport wind: vector mean of the levels inside the mixed layer (80 m when it is shallower) */
    let u = 0, v = 0, nn = 0;
    if (blh != null){
      for (const p of PLEV){ const zz = m["z" + p] ? m["z" + p][i] : null, ws = m["ws" + p] ? m["ws" + p][i] : null, wd = m["wd" + p] ? m["wd" + p][i] : null; if (zz == null || ws == null || wd == null || zz > Math.max(blh, 150)) continue; u += -ws*Math.sin(wd*Math.PI/180); v += -ws*Math.cos(wd*Math.PI/180); nn++; }
      if (!nn && m.s80[i] != null){ const wd = m.d80 && m.d80[i] != null ? m.d80[i] : m.d10[i]; if (wd != null){ u = -m.s80[i]*Math.sin(wd*Math.PI/180); v = -m.s80[i]*Math.cos(wd*Math.PI/180); nn = 1; } }
    }
    if (nn){ m.tw[i] = Math.hypot(u/nn, v/nn); m.twd[i] = (Math.atan2(-u/nn, -v/nn)*180/Math.PI + 360) % 360; }
    if (m.ndfdTw && m.ndfdTw[i] != null){ m.tw[i] = m.ndfdTw[i]; m.twd[i] = m.ndfdTwd && m.ndfdTwd[i] != null ? m.ndfdTwd[i] : m.twd[i]; }
    /* ventilation (m2/s) and the Lavdas dispersion index (LDSI) */
    if (blh != null && m.tw[i] != null){ m.vr[i] = blh*m.tw[i]*0.514444; const t = LAST_TL ? LAST_TL.t0 + i*H : null; const di = t != null ? ldsi(m, i, t) : null; m.di[i] = di == null ? null : Math.max(0, Math.round(di)); }
    /* Haines, low elevation: stability 950-850 hPa, moisture at 850 hPa */
    const t95 = m.t950 ? m.t950[i] : null, t85 = m.t850 ? m.t850[i] : null, rh85 = m.rh850 ? m.rh850[i] : null;
    if (t95 != null && t85 != null && rh85 != null){
      const A = fToC(t95) - fToC(t85), tc = fToC(t85), g = Math.log(Math.max(1, rh85)/100) + 17.625*tc/(243.04 + tc), td85 = 243.04*g/(17.625 - g), B = tc - td85;
      m.haines[i] = (A < 4 ? 1 : A < 8 ? 2 : 3) + (B < 6 ? 1 : B < 10 ? 2 : 3);
    }
    /* inversion: the lowest level where temperature rises with height (surface to 700 hPa), as its base
       in ft above ground (0 = surface-based); invlow = 1 when that base is under 1,000 ft */
    { const pts = T != null ? [{ h:0, T }] : [];
      for (const l of INV_LEV){ const tl = m["t" + l] ? m["t" + l][i] : null, zl = m["z" + l] ? m["z" + l][i] : null; if (tl == null || zl == null || zl <= 10) continue; pts.push({ h: zl*3.28084, T: tl }); }
      pts.sort((a, b) => a.h - b.h);
      if (pts.length >= 3){
        let base = null; for (let k = 0; k + 1 < pts.length; k++) if (pts[k + 1].T > pts[k].T + 0.1){ base = pts[k].h; break; }
        m.invh[i] = base == null ? null : Math.round(base/100)*100; m.invlow[i] = base != null && base < 1000 ? 1 : 0;
      }
    }
    /* LVORI from humidity and LDSI (MFL table) */
    if (m.rh[i] != null && m.di[i] != null) m.lvori[i] = lvori(m.rh[i], m.di[i]);
  }
  return m;
}
/* ---------- LDSI (TBW_MLB_MFL_DSI GFE tool, Lavdas) and LVORI (MFL GFE tool) ----------
   Inputs per member and hour: sky cover (%), ceiling (ft), 20 ft wind (kt), transport wind (kt),
   mixing height (ft). Day or night follows the sun at the Space Coast. */
const sunUp = t => {
  /* solar elevation at 28.5 N, 80.7 W */
  const d = new Date(t), doy = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0))/86400e3;
  const g = 2*Math.PI/365*(doy - 1 + (d.getUTCHours() - 12)/24), dec = 0.006918 - 0.399912*Math.cos(g) + 0.070257*Math.sin(g) - 0.006758*Math.cos(2*g) + 0.000907*Math.sin(2*g);
  const eq = 229.18*(0.000075 + 0.001868*Math.cos(g) - 0.032077*Math.sin(g) - 0.014615*Math.cos(2*g) - 0.040849*Math.sin(2*g));
  const tst = d.getUTCHours()*60 + d.getUTCMinutes() + 30 + eq + 4*-80.7, ha = (tst/4 - 180)*Math.PI/180, lat = 28.5*Math.PI/180;
  return Math.asin(Math.sin(lat)*Math.sin(dec) + Math.cos(lat)*Math.cos(dec)*Math.cos(ha)) > 0;
};
/* ceiling: MOS ceiling when the source has one, otherwise from the cloud layers */
const ceilOf = (m, i) => { const c = m.cig && m.cig[i]; if (c != null) return c; const cl = m.cl && m.cl[i], cm = m.cm && m.cm[i], ch = m.ch && m.ch[i];
  if (cl != null && cl >= 50) return m.lcb && m.lcb[i] != null ? m.lcb[i] : 3000; if (cm != null && cm >= 50) return 10000; if (ch != null && ch >= 50) return 25000; return 99999; };
/* stability class by net radiation index (rows 4 .. -2) and 20 ft wind (kt) */
const LAV_WIND = [1.5, 3.5, 5.5, 6.5, 7.5, 9.5, 10.5, 12.0];
const LAV_STAB = { 4:[1,1,1,2,2,2,3,3,3], 3:[1,2,2,2,2,3,3,3,4], 2:[2,2,3,3,3,3,4,4,4], 1:[3,3,4,4,4,4,4,4,4], 0:[4,4,4,4,4,4,4,4,4], "-1":[6,6,5,5,4,4,4,4,4], "-2":[7,7,6,6,5,5,5,4,4] };
function ldsi(m, i, t){
  const sky = m.sky ? m.sky[i] : null, w20 = m.s20 ? m.s20[i] : (m.s10 ? m.s10[i] : null), tw = m.tw[i], mh = m.mixh[i];
  if (sky == null || w20 == null || tw == null || mh == null) return null;
  const ceil = ceilOf(m, i), ovc = sky >= 95, day = sunUp(t);
  let nri = 0;
  if (!day){ nri = sky <= 40 ? -2 : !ovc ? -1 : ceil >= 7000 ? -1 : 0; }
  else {
    const d = new Date(t), doy = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0))/86400e3;
    let ic = doy > 75 && doy < 270 ? 4 : 3;                    /* sun above 60 deg mid-March to late September, else above 35 deg */
    if (sky > 50 && !ovc){ if (ceil < 7000) ic -= 2; else if (ceil < 16000) ic -= 1; }
    if (ovc && ceil >= 7000) ic -= 1;
    if (ic < 1) ic = 1;
    nri = ovc && ceil < 7000 ? 0 : ic;
  }
  const col = LAV_WIND.findIndex(x => w20 < x), stab = LAV_STAB[String(nri)][col < 0 ? 8 : col];
  const mm = Math.max(100, mh*0.3048), T = tw*0.5148;
  if (!day){
    if (stab === 4) return (mm >= 600 ? 3 : mm >= 400 ? 2.5 : 2)*T;
    if (stab === 5) return 1.5*T;
    if (stab > 5) return T;
    return 0;
  }
  if (stab === 1) return (-0.0000007*mm*mm + 0.0104*mm - 0.2822)*T;
  if (stab === 2) return (-0.000001*mm*mm + 0.01*mm - 0.0081)*T;
  if (stab === 3) return (4.0795*Math.log(mm) - 20.657)*T;
  if (stab === 4) return (((-0.000001*mm*mm + 0.0056*mm) + 1.2128)*T + (2.0905*Math.log(mm) - 9.0519)*T)/2;
  return 0;
}
/* LVORI: rows by RH band, columns LDSI >40, <=40, <=30, <=25, <=16, <=12, <=10, <=8, <=6, <=4, <=2, <=1 */
const LVORI_COLS = [40, 30, 25, 16, 12, 10, 8, 6, 4, 2, 1];
const LVORI_ROWS = [
  [97.0001, [4,4,4,5,5,7,8,8,9,9,10,10]], [95, [4,4,4,5,5,6,6,6,7,8,8,9]], [92, [4,4,4,5,5,5,6,6,6,6,7,8]], [89, [4,4,4,4,5,5,5,5,6,6,7,7]],
  [86, [4,4,4,4,4,5,5,5,5,6,6,6]], [83, [4,4,4,4,4,4,4,4,5,5,5,6]], [80, [3,3,3,3,4,4,4,4,4,5,5,6]], [75, [3,3,3,3,4,4,4,4,4,4,4,4]],
  [70, [3,3,3,3,3,3,3,3,3,3,3,4]], [65, [1,3,3,3,3,3,3,3,3,3,3,4]], [60, [1,1,2,2,2,2,3,3,3,3,3,3]], [55, [1,1,2,2,2,2,2,3,3,3,3,3]], [0, [1,1,2,2,2,2,2,2,2,2,2,2]]];
function lvori(rh, di){
  const row = (rh > 97 ? LVORI_ROWS[0] : LVORI_ROWS.slice(1).find(r => rh >= r[0]) || LVORI_ROWS[LVORI_ROWS.length - 1])[1];
  let k = 0; LVORI_COLS.forEach((c, j) => { if (di <= c) k = j + 1; });
  return row[k];
}
if (typeof window !== "undefined" && window.PAGE === "personal") VMAP.weather_code = "wc";
const VKEYS = Object.keys(VMAP).sort((a, b) => b.length - a.length);
async function getJSON(url, ms){
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms || 30000);
  try { const r = await fetch(url, { signal: ctl.signal, cache:"no-store" }); if (!r.ok){ const e = new Error("HTTP " + r.status); e.status = r.status; throw e; } return await r.json(); }
  finally { clearTimeout(tm); }
}
function omURL(base, model, vars){
  const lat = SITES.map(s => s.lat).join(","), lon = SITES.map(s => s.lon).join(",");
  return `${base}?latitude=${lat}&longitude=${lon}&hourly=${vars}&models=${model}&temperature_unit=fahrenheit&wind_speed_unit=kn&precipitation_unit=inch&timezone=GMT&timeformat=unixtime&forecast_days=8&past_days=2`;
}
/* returns per-site list of member objects, or throws */
async function fetchOM(src, ens, TL){
  const base = ens ? "https://ensemble-api.open-meteo.com/v1/ensemble" : "https://api.open-meteo.com/v1/forecast";
  let js;
  const vars = ens ? OM_VARS_ENS : OM_VARS;
  /* extra fields: fire weather on the burn page; the weather code (thunder) on the personal page */
  try { js = await getJSON(omURL(base, src.model, FIRE ? vars + "," + FIRE_VARS : PERS ? vars + ",weather_code" : vars), 45000); }
  catch (e){
    if (e.status !== 400) throw e;
    /* a model without some fire-weather fields: try without them, then the minimum set */
    try { js = await getJSON(omURL(base, src.model, vars), 45000); } catch (e2){ if (e2.status === 400) js = await getJSON(omURL(base, src.model, OM_MIN), 45000); else throw e2; }
  }
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
/* the ECMWF MOS bulletin (GFS MOS layout) -> rows like IEM's MOS JSON; columns read at the HR line's positions */
function parseEcmMOS(text){
  text = String(text || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const rows = [], re = /^\s*(K[A-Z0-9]{3})\s+ECMWF MOS GUIDANCE\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{2})(\d{2})\s*UTC/gm, heads = [];
  let m; while ((m = re.exec(text))) heads.push({ m, end: re.lastIndex });
  heads.forEach((h, n) => {
    const block = text.slice(h.end, n + 1 < heads.length ? heads[n + 1].m.index : text.length).split("\n");
    const stn = h.m[1], run = Date.UTC(+h.m[4], +h.m[2] - 1, +h.m[3], +h.m[5], +h.m[6]);
    const hr = block.find(l => l.trim().startsWith("HR")); if (!hr) return;
    const cols = []; const rx = /\d+/g; let c2; while ((c2 = rx.exec(hr))) cols.push({ b: c2.index + c2[0].length, h: +c2[0] });
    let prev = run; const times = cols.map(c3 => { const d = new Date(prev); let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), c3.h % 24); while (t <= prev) t += 24*H; prev = t; return t; });
    const lines = {}; for (const l of block){ const k = (l.match(/^\s*([A-Z0-9/]{3})\s/) || [])[1]; if (["TMP","DPT","CLD","WDR","WSP","P06","P12","T06","T12"].includes(k)) lines[k] = l; }
    cols.forEach((c3, j) => {
      const r = { station: stn, runtime: new Date(run).toISOString(), ftime: new Date(times[j]).toISOString() };
      for (const [k, l] of Object.entries(lines)){ const cell = l.slice(Math.max(0, c3.b - 3), c3.b).trim(); if (!cell) continue;
        if (k === "CLD") r.cld = cell; else if (/^-?\d+$/.test(cell)) r[k.toLowerCase()] = k === "WDR" ? +cell*10 : +cell; }
      if (Object.keys(r).length > 3) rows.push(r);
    });
  });
  return rows;
}
async function fetchMOS(src, TL){
  let js = null, from = "";
  try { js = await getJSON(`${DATA_BASE}data/mos/${src.model}.json?ts=${Date.now()}`, 8000); from = "mirror"; } catch (e) { js = null; }
  /* ECMWF MOS isn't on IEM: without the mirror, read the bulletin straight from its site */
  if (src.model === "ECM" && (!js || !rowsOf(js).length)){
    const r = await fetch(`https://nluchetti1.github.io/ecmwf-mos/?ts=${Date.now()}`, { cache:"no-store" }); if (!r.ok) throw new Error("ECMWF MOS not reachable");
    js = { data: parseEcmMOS(await r.text()) }; from = "ecmwf-mos";
  }
  if (!js || !rowsOf(js).length){
    if (src.model === "ECM") throw new Error("no ECMWF MOS bulletin");
    const st = stationsNow().map(s => "station=" + s).join("&");
    js = await getJSON(`https://mesonet.agron.iastate.edu/api/1/mos.json?${st}&model=${src.model}`, 30000); from = "IEM";
  }
  let rows = rowsOf(js);
  const byStn = {};
  for (const r of rows){ const k = String(pick(r, ["station"]) || "").toUpperCase(); (byStn[k] = byStn[k] || []).push(r); }
  /* stations the mirror doesn't carry (a custom TAF site, say) come straight from IEM */
  const missing = stationsNow().filter(s => !byStn[s] && !byStn[s.slice(1)]);
  if (from === "mirror" && missing.length && src.model !== "ECM"){
    try {
      const j2 = await getJSON(`https://mesonet.agron.iastate.edu/api/1/mos.json?${missing.map(s => "station=" + s).join("&")}&model=${src.model}`, 30000);
      for (const r of rowsOf(j2)){ const k = String(pick(r, ["station"]) || "").toUpperCase(); (byStn[k] = byStn[k] || []).push(r); }
    } catch (e) { /* not reachable from this browser */ }
  }
  const out = {};
  for (const stn of stationsNow()){
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
    if (src.model === "ECM"){ addI("pop", ["p06"], 6); addI("tst", ["t06"], 6); }
  }
  m.gap = src.model === "GFSX" || src.model === "NBE" ? 12 : 3;
  deriveMember(m, TL.n);
  return { members:[m], iv, run };
}

/* ---------- waves and sea state (Open-Meteo marine) as one member ----------
   significant wave height and swell in ft, period in s, direction in degrees, water temperature in F */
const MARINE = { id:"marine", name:"Open-Meteo marine", fam:"global" };
async function fetchMarine(sites, TL){
  const out = {};
  for (const s of sites){
    try {
      const js = await getJSON(`https://marine-api.open-meteo.com/v1/marine?latitude=${s.lat}&longitude=${s.lon}&hourly=wave_height,swell_wave_height,wave_period,wave_direction,sea_surface_temperature&timezone=GMT&timeformat=unixtime&forecast_days=10&past_days=2`, 25000);
      const hr = js.hourly || {}, m = {}; MARINE_KEYS.forEach(k => m[k] = new Array(TL.n).fill(null));
      (hr.time || []).forEach((t, j) => { const i = TL.idx(t*1000); if (i < 0 || i >= TL.n) return;
        const g = k => hr[k] ? hr[k][j] : null;
        if (g("wave_height") != null) m.wvh[i] = g("wave_height")*3.28084; if (g("swell_wave_height") != null) m.swh[i] = g("swell_wave_height")*3.28084;
        m.wvp[i] = g("wave_period"); m.wvd[i] = g("wave_direction"); if (g("sea_surface_temperature") != null) m.sst[i] = g("sea_surface_temperature")*9/5 + 32; });
      if (m.wvh.some(v => v != null)) out[s.id] = { members:[marineMember(m, TL.n)] };
    } catch (e) { /* inland, or the marine model isn't reachable */ }
  }
  return out;
}
/* a marine member carries only sea-state fields; give it the standard ones (empty) so blocks and blends work */
function marineMember(m, n){ for (const k of new Set(Object.values(VMAP))) if (!m[k]) m[k] = new Array(n).fill(null); m.gap = 3; const keep = {}; MARINE_KEYS.forEach(k => keep[k] = m[k]); deriveMember(m, n); Object.assign(m, keep); return m; }
/* place search (Open-Meteo geocoding): towns, cities and places by name */
async function geocode(q){
  const js = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`, 12000);
  return (js.results || []).map(r => ({ name: r.name, area: [r.admin1, r.country_code].filter(Boolean).join(", "), lat: r.latitude, lon: r.longitude, tz: r.timezone }));
}
/* ---------- NWS forecast (NDFD) ----------
   api.weather.gov: /points/{lat},{lon} gives the forecast grid; its gridData holds every NDFD element as
   time series ("2026-10-28T12:00:00+00:00/PT3H"). Each value fills the hours it covers. */
const _ndfdGrid = {};
async function fetchNDFD(sites, TL){
  const out = {};
  const KMH2KT = 0.539957, M2FT = 3.28084;
  const conv = (prop, v) => { if (v == null) return null; const u = String(prop.uom || prop.unitCode || "");
    if (/degC/.test(u)) return v*9/5 + 32; if (/km_h/.test(u)) return v*KMH2KT; if (/m_s/.test(u)) return v*1.943844; return v; };
  const dur = s => { const m = String(s || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?/); return ((+m[1] || 0)*24 + (+m[2] || 0)) || 1; };
  for (const s of sites){
    const key = `${(+s.lat).toFixed(3)},${(+s.lon).toFixed(3)}`;
    try {
      let url = _ndfdGrid[key];
      if (!url){ const pt = await getJSON(`https://api.weather.gov/points/${key}`, 15000); url = _ndfdGrid[key] = pt.properties && pt.properties.forecastGridData; }
      if (!url) continue;
      const js = await getJSON(url, 25000), P = js.properties || {};
      const m = { t:[], td:[], sky:[], s10:[], d10:[], g10:[], vis:[], cig:[], lcb:[], rh:[], ndfdTw:[], ndfdTwd:[], ndfd20:[], ndfdMix:[] };
      Object.keys(m).forEach(k => m[k] = new Array(TL.n).fill(null));
      const iv = { pop:[], tst:[] };
      const fill = (name, key2, f) => { const prop = P[name]; if (!prop || !prop.values) return;
        for (const it of prop.values){ const [st, d] = String(it.validTime).split("/"); const a = Date.parse(st), h = dur(d), v = f ? f(conv(prop, it.value)) : conv(prop, it.value); if (v == null || !isFinite(v)) continue;
          for (let k = 0; k < h; k++){ const i = TL.idx(a + k*H); if (i >= 0 && i < TL.n) m[key2][i] = v; } } };
      fill("temperature", "t"); fill("dewpoint", "td"); fill("skyCover", "sky"); fill("relativeHumidity", "rh");
      fill("windSpeed", "s10"); fill("windDirection", "d10"); fill("windGust", "g10");
      fill("visibility", "vis"); fill("ceilingHeight", "cig", v => v*M2FT);
      fill("transportWindSpeed", "ndfdTw"); fill("transportWindDirection", "ndfdTwd"); fill("twentyFootWindSpeed", "ndfd20"); fill("mixingHeight", "ndfdMix");
      /* probabilities as intervals, like MOS */
      const ivs = (name, kind) => { const prop = P[name]; if (!prop || !prop.values) return; for (const it of prop.values){ const [st, d] = String(it.validTime).split("/"); const a = Date.parse(st); if (it.value == null) continue; iv[kind].push({ a, b: a + dur(d)*H, p: Math.max(0, Math.min(1, it.value/100)) }); } };
      ivs("probabilityOfPrecipitation", "pop"); ivs("probabilityOfThunder", "tst");
      if (!iv.tst.length && P.weather && P.weather.values){
        /* the NWS weather grid's thunderstorm coverage words, as chances */
        const COV = { slight_chance:15, isolated:15, chance:35, scattered:35, occasional:35, likely:65, numerous:65, frequent:65, periods:65, definite:85, widespread:85 };
        for (const it of P.weather.values){
          const [st, d] = String(it.validTime).split("/"), a = Date.parse(st); let p = 0;
          for (const w of it.value || []) if (w && /thunder/.test(w.weather || "")) p = Math.max(p, COV[w.coverage] || 25);
          iv.tst.push({ a, b: a + dur(d)*H, p: p/100 });
        }
      }
      /* NDFD gusts are only given when they exceed the wind; keep gust >= sustained */
      for (let i = 0; i < TL.n; i++){ if (m.s10[i] != null && (m.g10[i] == null || m.g10[i] < m.s10[i])) m.g10[i] = m.s10[i]; }
      /* fire weather: NDFD mixing height and transport wind stand in for the model fields */
      m.blh = m.ndfdMix.slice();   /* meters, as the model boundary-layer height */
      m.gap = 3; deriveMember(m, TL.n);
      if (FIRE) for (let i = 0; i < TL.n; i++){ if (m.ndfd20[i] != null && m.s20) m.s20[i] = m.ndfd20[i]; }
      out[s.id] = { members:[m], iv, run: Date.parse(P.updateTime || P.validTimes && String(P.validTimes).split("/")[0]) || null };
    } catch (e) { /* this point isn't in an NWS grid, or the NWS isn't reachable */ }
  }
  return out;
}
/* High-res pipeline output: RRFS, REFS members, time-lagged HRRR and RRFS, REFS calibrated thunder */
async function fetchPipeline(TL){
  const js = await getJSON(`${DATA_BASE}data/hires.json?ts=${Date.now()}`, 15000);
  const out = {};
  for (const src of js.sources || []){
    const per = {};
    for (const s of SITES){
      let st = (src.sites || {})[s.id];
      if (!st){ let best = null, d = 15; for (const id in (src.sites || {})){ const q = PIPE_POINTS[id]; if (!q) continue; const k = kmBetween(s.lat, s.lon, q[0], q[1]); if (k < d){ d = k; best = id; } } st = best ? src.sites[best] : null; }
      if (!st) continue;
      const members = (st.members || []).map(mm => {
        const m = {};
        for (const k in mm){ if (!Array.isArray(mm[k])){ m[k] = mm[k]; continue; } const arr = new Array(TL.n).fill(null); mm[k].forEach((v, j) => { const i = TL.idx(src.t0 + j*H); if (i >= 0 && i < TL.n && v != null) arr[i] = v; }); m[k] = arr; }
        m.gap = src.gap || 3; return deriveMember(m, TL.n);
      }).filter(m => m.t.some(v => v != null));
      const iv = st.iv ? { tst: st.iv.tst || [], tst4: st.iv.tst4 || [] } : null;
      if (members.length || (iv && iv.tst.length)) per[s.id] = { members, iv };
    }
    out[src.id] = { run: Date.parse(src.run), per, n: Math.max(0, ...Object.values(per).map(x => x.members.length)) };
  }
  /* why a source is missing or short, as the pipeline recorded it */
  out._status = js.status || {};
  out._generated = js.generated ? Date.parse(js.generated) : null;
  return out;
}

/* SPC Day 1-3 categorical outlook (point in polygon). Optional; fails quietly. */
/* WPC Excessive Rainfall Outlook, Days 1-5 (NWS map service; mirrored by the MOS workflow) */
const ERO_URL = d => `https://mapservices.weather.noaa.gov/vector/rest/services/hazards/wpc_precip_hazards/MapServer/${d - 1}/query?where=1%3D1&outFields=dn,outlook,start_time,end_time,issue_time&returnGeometry=true&outSR=4326&f=geojson`;
function eroTime(s){
  s = String(s || "").trim(); if (!s) return null;
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):?(\d{2})/); if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):?(\d{2})/); if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})?/); if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +(m[5] || 0));
  return null;
}
async function fetchERO(){
  const out = [], CAT = { 1:"MRGL", 2:"SLGT", 3:"MDT", 4:"HIGH" };
  /* each outlook day runs 12Z to 12Z; used when a feature carries no readable times */
  const n = new Date(), d12 = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 12) - (n.getUTCHours() < 12 ? 24*H : 0);
  for (const d of [1, 2, 3, 4, 5]){
    try {
      let js = null;
      try { js = await getJSON(`${DATA_BASE}data/mos/wpc_ero_day${d}.json?ts=${Date.now()}`, 8000); } catch (e) { js = null; }
      if (!js || !js.features) js = await getJSON(ERO_URL(d), 15000);
      for (const f of js.features || []){
        const pr = f.properties || {}; let cat = CAT[pr.dn];
        if (!cat){ const t = String(pr.outlook || "").toUpperCase(); cat = /HIGH/.test(t) ? "HIGH" : /MODERATE/.test(t) ? "MDT" : /SLIGHT/.test(t) ? "SLGT" : /MARGINAL/.test(t) ? "MRGL" : null; }
        if (!cat || !f.geometry) continue;
        const a = eroTime(pr.start_time) ?? d12 + (d - 1)*24*H, b = eroTime(pr.end_time) ?? a + 24*H;
        out.push({ cat, a, b: b > a ? b : a + 24*H, geom: f.geometry, day:d });
      }
    } catch (e) { /* not reachable from this browser */ }
  }
  return out;
}
/* SPC hail probability (within 25 mi of a point), Days 1 and 2; significant-hail areas are flagged */
async function fetchHail(){
  const out = [];
  for (const d of [1, 2]){
    try {
      let js = null;
      try { js = await getJSON(`${DATA_BASE}data/mos/spc_hail_day${d}.json?ts=${Date.now()}`, 8000); } catch (e) { js = null; }
      if (!js || !js.features) js = await getJSON(`https://www.spc.noaa.gov/products/outlook/day${d}otlk_hail.nolyr.geojson`, 15000);
      const pt = s => { s = String(s || ""); return Date.UTC(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8), +s.slice(8,10), +s.slice(10,12)); };
      for (const f of js.features || []){
        const pr = f.properties || {}, lab = String(pr.LABEL || pr.label || ""), lab2 = String(pr.LABEL2 || "");
        const sig = /SIG/i.test(lab) || /significant/i.test(lab2);
        const p = sig ? null : (+lab < 1 && +lab > 0 ? Math.round(+lab*100) : +pr.DN);
        if (!f.geometry || (!sig && !(p > 0))) continue;
        out.push({ p, sig, a: pt(pr.VALID), b: pt(pr.EXPIRE), geom: f.geometry, day:d });
      }
    } catch (e) { /* not reachable from this browser */ }
  }
  return out;
}
async function fetchSPC(){
  const out = [];
  for (const d of [1,2,3]){
    try {
      let js = null;
      try { js = await getJSON(`${DATA_BASE}data/mos/spc_day${d}.json?ts=${Date.now()}`, 8000); } catch (e) { js = null; }
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
  const hk = hkeys();
  if (row.len === 1){ const i = rng[0]; ["t","td","wbgt","sky", ...hk].forEach(k => o[k] = m[k] ? m[k][i] : null); o.tmax = o.tmin = m.t[i]; o.vmin = m.vis[i]; }
  else {
    o.tmax = agg(m.t, "max"); o.tmin = agg(m.t, "min"); o.t = row.daytime ? o.tmax : o.tmin;
    o.td = agg(m.td, "mean"); o.wbgt = agg(m.wbgt, "max"); o.sky = agg(m.sky, "mean");
    hk.forEach(k => o[k] = m[k] ? agg(m[k], "max") : null); o.vmin = agg(m.vis, "min");
  }
  let u = 0, v = 0, nn = 0; for (const i of (row.len === 1 ? [rng[0]] : rng)){ const d = m.d10[i], s = m.s10[i]; if (d == null || s == null) continue; const w = Math.max(0.3, s); u += -Math.sin(d*Math.PI/180)*w; v += -Math.cos(d*Math.PI/180)*w; nn++; }
  o.du = nn ? u/nn : null; o.dv = nn ? v/nn : null;
  const mx = ks => { const v = ks.map(k => o[k]).filter(x => x != null); return v.length ? Math.max(...v) : null; };
  o.smax = mx(HEIGHTS.map(f => "s" + f)); o.gmax = mx(HEIGHTS.map(f => "g" + f));
  /* rainfall: the total over the row */
  if (m.pr){ let s2 = 0, n2 = 0, mx2 = null; for (const i of rng){ const v = m.pr[i]; if (v == null) continue; s2 += v; n2++; if (mx2 == null || v > mx2) mx2 = v; } o.qpf = n2 ? s2 : null; o.prmax = mx2; }
  if (RHROW){
    /* RH like temperature; waves: highest in a block, period and water temperature averaged, direction from the first hour */
    const how = { rh:"min", wvh:"max", swh:"max", wvp:"mean", sst:"mean" };
    for (const k of ["rh", ...MARINE_KEYS]){ const a = m[k]; if (!a) continue; o[k] = row.len === 1 || k === "wvd" ? a[rng[0]] : agg(a, how[k]); }
  }
  if (FIRE){
    const how = { rh:"min", mixh:"max", tw:"mean", vr:"max", di:"max", lvori:"max", invh:"min", invlow:"max" };
    for (const k of FIRE_KEYS){ const a = m[k]; if (!a) continue; o[k] = row.len === 1 ? a[rng[0]] : agg(a, how[k]); o[k + "Lo"] = agg(a, "min"); o[k + "Hi"] = agg(a, "max"); }
    for (const k of [...hk, "t"]){ if (!m[k]) continue; o[k + "Lo"] = agg(m[k], "min"); o[k + "Hi"] = agg(m[k], "max"); }
    let tu = 0, tv = 0, tn = 0; for (const i of (row.len === 1 ? [rng[0]] : rng)){ const d = m.twd[i], s = m.tw[i]; if (d == null || s == null) continue; tu += -Math.sin(d*Math.PI/180)*s; tv += -Math.cos(d*Math.PI/180)*s; tn++; }
    o.tu = tn ? tu/tn : null; o.tv = tn ? tv/tn : null;
    o.dirm = o.du != null ? (Math.atan2(-o.du, -o.dv)*180/Math.PI + 360) % 360 : null;
    o.rx = typeof window !== "undefined" && window.FIRE_RX ? window.FIRE_RX(o) : null;
  }
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
  constructor(site, TL, rows){ this.site = site; this.TL = TL; this.rows = rows; this.src = []; this.sev = []; this.ero = []; this.hail = []; }
  addSource(def, members, extra){
    const s = { def, members, iv: extra && extra.iv, run: extra && extra.run, blocks: members.map(m => this.rows.map(r => { const b = blockOf(m, r, this.TL); if (b && m.lw != null) b.lw = m.lw; return b; })), win: new Map() };
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
    else if (ev === "tst" && PERS && s.members.some(m => m.wc && m.wc.some(v => v != null))){
      let h = 0, n = 0;
      for (const m of s.members){ if (!m.wc) continue; let hit = null; for (let t = A; t < B; t += H){ const i = this.TL.idx(t); if (i < 0 || i >= this.TL.n) continue; const v = m.wc[i]; if (v == null) continue; hit = hit || v >= 95; } if (hit == null) continue; h += hit ? 1 : 0; n++; }
      p = n ? h/n : null;
    }
    else if (ev === "pop"){
      if (s.def.id === "nbm" && s.members[0] && s.members[0].pp.some(v => v != null)) p = nbmPop(s.members[0], A, B, this.TL);
      else { let h = 0, n = 0; for (const m of s.members){ const o = memberPrecip(m, A, B, this.TL); if (o == null) continue; const lw = m.lw ?? 1; h += o*lw; n += lw; } p = n ? h/n : null; }
    }
    s.win.set(key, p); return p;
  }
}

/* aggregate everything for the current source selection; returns {val:{k:[]}, srcv:{k:{id:[]}}, band:{k:[[lo,hi]]}} */
/* ---------- automatic weights from verification (docs/data/verif/weights.json) ----------
   Per forecast point, parameter group and lead band; other points use the nearest verified point. */
let AUTO_W = null;
const AUTO_GROUP = k => /^(t|td|wbgt|tmax|tmin)$/.test(k) ? "t" : /^s\d+$|^smax$/.test(k) ? "s" : /^g\d+$|^gmax$/.test(k) ? "g" : k === "dir" ? "d" : k === "pop" ? "pp" : k === "tst" ? "lt" : null;
function autoPoint(site){
  if (!AUTO_W || !AUTO_W.points) return null;
  if (AUTO_W.points[site.id]) return site.id;
  let best = null, bd = 25;
  for (const [id, ll] of Object.entries(AUTO_W.points)){ const d = kmBetween(site.lat, site.lon, ll[0], ll[1]); if (d < bd){ bd = d; best = id; } }
  return best;
}
function autoBand(leadH){ const bands = (AUTO_W && AUTO_W.bands) || []; for (const [a, b, n] of bands) if (leadH >= a && leadH < b) return n; return bands.length ? bands[bands.length - 1][2] : null; }
function autoFactor(G, prefs, sid, key, startMs){
  if (!AUTO_W || prefs.autoW === false) return 1;
  if (G._autoFor !== AUTO_W){ G._autoFor = AUTO_W; G._autoPt = autoPoint(G.site); }
  const pt = G._autoPt; if (!pt) return 1;
  const grp = AUTO_GROUP(key); if (!grp) return 1;
  const band = autoBand(Math.max(0, (startMs - Date.now())/H)); if (!band) return 1;
  const w = (((AUTO_W.weights || {})[pt] || {})[grp] || {})[band];
  return w && w[sid] != null ? w[sid] : 1;
}
/* the NBM family (gridded NBM, NBM text, NBM text extended) shares one weight: the sources with data at
   a time split it, except for thunder, which only the text products carry */
const NBM_FAMILY = new Set(["nbm", "nbs", "nbe"]);
/* ---------- blend by parameter ----------
   prefs.grpSrc = { temp | sky | wind | precip | thunder: { mode:"all"|"mos"|"hires"|"global"|"ens"|"nbm"|"nws"|"custom", ids:[...] } }
   Each parameter group blends only its chosen sources (automatic and your weights still apply among them);
   a row where the chosen sources have no value falls back to all sources. */
const BLEND_GROUPS = [
  ["temp",    "Temperature, dew point, humidity, WBGT"],
  ["sky",     "Sky cover and visibility"],
  ["wind",    "Winds (every height, peaks and direction)"],
  ["precip",  "Precipitation chance and rain amount"],
  ["thunder", "Lightning chance"],
];
const BLEND_PRESETS = [["all", "All selected sources"], ["mos", "MOS and LAMP"], ["hires", "High resolution"], ["global", "Global models"], ["ens", "Ensembles"], ["nbm", "NBM (gridded and text)"], ["nws", "NWS forecast"], ["custom", "Choose sources…"]];
function blendGroupOf(k){
  if (/^(t|td|wbgt|rh|tmax|tmin|hix)$/.test(k)) return "temp";
  if (/^(sky|vis|vmin|cig)$/.test(k)) return "sky";
  if (/^([sg]\d+|smax|gmax|dir|du|dv)$/.test(k)) return "wind";
  if (/^(qpf|prmax|pop|pp\d?)$/.test(k)) return "precip";
  if (/^(tst|lt\d?)$/.test(k)) return "thunder";
  return null;
}
function blendAllows(prefs, grp, s){
  const c = grp && prefs.grpSrc && prefs.grpSrc[grp]; if (!c || !c.mode || c.mode === "all") return true;
  const id = s.def.id, fam = s.def.fam;
  switch (c.mode){
    case "mos": return fam === "mos";
    case "hires": return fam === "hires";
    case "global": return fam === "global";
    case "ens": return fam === "ens";
    case "nbm": return NBM_FAMILY.has(id);
    case "nws": return fam === "nws";
    case "custom": return (c.ids || []).includes(id);
  }
  return true;
}
function aggregate(G, prefs){
  const rows = G.rows, on = G.src.filter(s => prefs.enabled[s.def.id] !== false && (prefs.weight[s.def.id] ?? s.def.w ?? 1) > 0);
  const W0 = s => prefs.weight[s.def.id] ?? s.def.w ?? 1;
  const famAt = new Map(), fam = on.filter(s => NBM_FAMILY.has(s.def.id));
  const famN = ri => { if (famAt.has(ri)) return famAt.get(ri); const n = fam.filter(s => s.blocks.some(b => b[ri] && b[ri].t != null)).length; famAt.set(ri, n); return n; };
  const share = (s, k, ri) => NBM_FAMILY.has(s.def.id) && !/^lt|tst/.test(k) ? 1/Math.max(1, famN(ri)) : 1;
  const WK = (s, k, ri) => W0(s)*autoFactor(G, prefs, s.def.id, k, rows[ri] ? rows[ri].a : Date.now())*share(s, k, ri);
  const val = {}, srcv = {}, band = {}, mem = {};
  const scal = ["t","td","wbgt","sky","qpf", ...hkeys(), ...(FIRE ? FIRE_KEYS : []), ...(PERS ? ["rh", ...MARINE_KEYS] : RHROW ? ["rh"] : [])];
  for (const k of [...scal, "dir", ...(FIRE ? ["tdir"] : [])]){ val[k] = []; srcv[k] = {}; band[k] = []; }
  for (const k of new Set(["tmax","tmin","smax","gmax","vmin", ...PARAMS.filter(p => p.ex).map(p => p.ex)])) mem[k] = [];
  /* the sources each parameter blends (see blend by parameter) */
  const onCache = {};
  const onFor = k => { const g = blendGroupOf(k); if (!g) return on; if (onCache[g]) return onCache[g]; return (onCache[g] = on.filter(s => blendAllows(prefs, g, s))); };
  const hasVal = (list, k, ri) => list.some(s => s.blocks.some(b => b[ri] && b[ri][k] != null));
  G.blendFallback = {};
  rows.forEach((r, ri) => {
    for (const k of scal){
      const pairs = [], vals = [], wts = [];
      let useOn = onFor(k); if (useOn !== on && !hasVal(useOn, k, ri)){ useOn = on; (G.blendFallback[blendGroupOf(k)] = G.blendFallback[blendGroupOf(k)] || new Set()).add(ri); }
      for (const s of useOn){
        const bs = s.blocks.map(b => b[ri]).filter(b => b && b[k] != null);
        if (!bs.length) continue;
        const lwSum = bs.reduce((a, b) => a + (b.lw ?? 1), 0);
        const mean = bs.reduce((a, b) => a + b[k]*(b.lw ?? 1), 0)/lwSum;
        (srcv[k][s.def.id] = srcv[k][s.def.id] || [])[ri] = mean;
        const w = WK(s, k, ri);
        pairs.push([mean, w]);
        bs.forEach(b => { vals.push(b[k]); wts.push(w*(b.lw ?? 1)/lwSum); });
      }
      val[k][ri] = wmean(pairs);
      band[k][ri] = vals.length >= 6 ? wquant(vals, wts, [0.1, 0.9]) : null;
    }
    let U = 0, V = 0, ww = 0;
    let onDir = onFor("dir"); if (onDir !== on && !onDir.some(s => s.blocks.some(b => b[ri] && b[ri].du != null))) onDir = on;
    for (const s of onDir){
      const bs = s.blocks.map(b => b[ri]).filter(b => b && b.du != null); if (!bs.length) continue;
      const lws = bs.reduce((a, b) => a + (b.lw ?? 1), 0), u = bs.reduce((a, b) => a + b.du*(b.lw ?? 1), 0)/lws, v = bs.reduce((a, b) => a + b.dv*(b.lw ?? 1), 0)/lws;
      (srcv.dir[s.def.id] = srcv.dir[s.def.id] || [])[ri] = (Math.atan2(-u, -v)*180/Math.PI + 360) % 360;
      const w = WK(s, "dir", ri); U += u*w; V += v*w; ww += w;
    }
    val.dir[ri] = ww ? (Math.atan2(-U, -V)*180/Math.PI + 360) % 360 : null;
    if (FIRE){
      let tU = 0, tV = 0, tw2 = 0;
      for (const s of on){ const bs = s.blocks.map(b => b[ri]).filter(b => b && b.tu != null); if (!bs.length) continue; const u = bs.reduce((a, b) => a + b.tu, 0)/bs.length, v = bs.reduce((a, b) => a + b.tv, 0)/bs.length; (srcv.tdir[s.def.id] = srcv.tdir[s.def.id] || [])[ri] = (Math.atan2(-u, -v)*180/Math.PI + 360) % 360; const w = WK(s, "dir", ri); tU += u*w; tV += v*w; tw2 += w; }
      val.tdir[ri] = tw2 ? (Math.atan2(-tU, -tV)*180/Math.PI + 360) % 360 : null;
    }
    for (const k of Object.keys(mem)){
      const list = [];
      /* member keys: tmax/tmin, smax/gmax, vmin, a height (g60), rain (qpf, prmax), prescription limits (rhLo, tHi), dirm */
      const exG = blendGroupOf(k) || blendGroupOf(k.replace(/(Lo|Hi)$/, "")) || (k === "dirm" ? "wind" : null);
      let memOn = exG ? on.filter(s => blendAllows(prefs, exG, s)) : on; if (memOn.length !== on.length && !hasVal(memOn, k, ri)) memOn = on;
      for (const s of memOn){ const bs = s.blocks.map(b => b[ri]).filter(b => b && b[k] != null); const w = WK(s, k, ri), lws = bs.reduce((a, b) => a + (b.lw ?? 1), 0); bs.forEach(b => list.push([b[k], w*(b.lw ?? 1)/lws, s.def.id])); }
      mem[k][ri] = list;
    }
  });
  /* window probabilities */
  const winP = (ev, A, B, per) => {
    const pairs = [];
    const fams = [];
    const grp = ev === "tst" ? "thunder" : "precip";
    let wOn = on.filter(s => blendAllows(prefs, grp, s));
    if (wOn.length !== on.length && !wOn.some(s => G.srcWin(s, ev, A, B) != null)) wOn = on;
    for (const s of wOn){ const p = G.srcWin(s, ev, A, B); if (p == null) continue; pairs.push([p, W0(s)*autoFactor(G, prefs, s.def.id, ev, A)]); if (NBM_FAMILY.has(s.def.id)) fams.push(pairs.length - 1); if (per) per[s.def.id] = p; }
    /* precipitation: the NBM sources with a value split one weight (thunder keeps full weight) */
    if (ev !== "tst" && fams.length > 1) fams.forEach(i => pairs[i][1] /= fams.length);
    return wmean(pairs);
  };
  for (const pk of ["pp1","pp3","pp6","lt1","lt3","lt6"].filter(k => P[k])){
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
  for (const p of PARAMS.filter(p => p.ex)){ val[p.k] = []; srcv[p.k] = {}; }
  G.mem = mem; G.on = on;
  /* severe: SPC outlook */
  val.sev = rows.map(r => {
    let best = "-";
    for (const o of G.sev){ if (r.a < o.b && r.b > o.a && inGeom(G.site.lon, G.site.lat, o.geom) && SEV.indexOf(o.cat) > SEV.indexOf(best)) best = o.cat; }
    return best;
  });
  /* hail: the highest SPC hail probability over the row; a significant-hail area is marked */
  val.hailp = rows.map(r => { let best = null; for (const o of (G.hail || [])){ if (o.sig || !(r.a < o.b && r.b > o.a) || !inGeom(G.site.lon, G.site.lat, o.geom)) continue; if (best == null || o.p > best) best = o.p; } return best ?? 0; });
  val.hailsig = rows.map(r => (G.hail || []).some(o => o.sig && r.a < o.b && r.b > o.a && inGeom(G.site.lon, G.site.lat, o.geom)));
  /* excessive rainfall: WPC outlook */
  val.ero = rows.map(r => {
    let best = "-";
    for (const o of (G.ero || [])){ if (r.a < o.b && r.b > o.a && inGeom(G.site.lon, G.site.lat, o.geom) && SEV.indexOf(o.cat) > SEV.indexOf(best)) best = o.cat; }
    return best;
  });
  return { val, srcv, band };
}
/* which window a precip/lightning cell represents */
/* which window a precip/lightning cell represents:
   "win" = the probability for [A,B); "max" = highest 1 h (or 3 h) period inside a longer block;
   null = covered by an earlier cell's window, or before the first aligned window */
/* which window a probability cell covers: the row itself, or a longer window starting with it.
   A window shorter than the row has no cell (a 1 hr chance isn't shown on a 3 or 6 hr row). */
function probCell(r, win){
  if (r.len === win) return { mode:"win", A:r.a, B:r.b };
  if (r.len > win) return null;
  return r.lh % win === 0 ? { mode:"win", A:r.a, B:r.a + win*H } : null;
}
const inSector = (d, a, b) => { if (d == null) return false; d = ((d % 360) + 360) % 360; a = ((a % 360) + 360) % 360; b = ((b % 360) + 360) % 360; return a <= b ? d >= a && d <= b : d >= a || d <= b; };
/* exceedance probability for one row given a delta shift */
function exceed(G, pk, ri, delta, hot){
  const p = P[pk]; const list = G.mem[p.ex][ri]; if (!list || !list.length) return { v:null, per:{} };
  const thr = p.v === "hot" ? hot : p.v;
  const bySrc = {};
  for (const [x, w, id] of list){ const y = x + (p.ex === "vmin" || p.noShift ? 0 : delta); const hit = p.op === "in" ? inSector(x, p.v[0], p.v[1]) : p.op === ">" ? y > thr : p.op === ">=" ? y >= thr : p.op === "<=" ? y <= thr : y < thr; const o = bySrc[id] = bySrc[id] || { h:0, n:0, w:0 }; o.h += hit ? w : 0; o.w += w; }
  let s = 0, w = 0; const per = {};
  for (const id in bySrc){ const o = bySrc[id]; per[id] = 100*o.h/o.w; s += o.h; w += o.w; }
  return { v: w ? 100*s/w : null, per };
}

/* ---------- public copies for the products page (interim, GitHub Pages) ----------
   A public copy is a ZIP holding docs/products/<type>/<id>.json (what the products page lists) plus the
   product's HTML and PDF. The forecaster unzips it and uploads the docs folder to the products
   repository; a workflow there rebuilds the index. Only planning forecasts, TAFs, mission weather products
   (page 1) and LMEFs for publicly announced launches can be made public, and only after the forecaster confirms they are cleared. */
const PUBLIC_TYPES = ["planning", "taf", "lmef", "mwp"];
const _crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function storeZip(files){
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const crc = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = _crcT[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const d = new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  for (const [name, body] of files){
    const nb = enc.encode(name), data = typeof body === "string" ? enc.encode(body) : body, c = crc(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, dt, true); lh.setUint16(12, dd, true);
    lh.setUint32(14, c, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nb, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dt, true); ch.setUint16(14, dd, true);
    ch.setUint32(16, c, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nb);
    off += 30 + nb.length + data.length;
  }
  const csz = central.reduce((s, x) => s + x.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csz, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type:"application/zip" });
}
/* meta: { type, key, title, issued (ms), forecaster, headline, ...type-specific summary };
   files: { html?: string, pdf?: Blob }. Returns the ZIP and its file name. */
async function publicSnapshot(meta, files){
  if (!PUBLIC_TYPES.includes(meta.type)) throw new Error("This product type isn't cleared for the public page");
  const p = new Date(meta.issued), stamp = p.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "_");
  const slug = String(meta.key || meta.type).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const id = `${slug}-${stamp}`, dir = `docs/products/${meta.type}/`;
  const rec = { schema:1, id, ...meta, issued: new Date(meta.issued).toISOString(), audience:"public", files:{} };
  const out = [];
  if (files.html){ rec.files.html = `${meta.type}/${id}.html`; out.push([dir + id + ".html", files.html]); }
  if (files.pdf){ rec.files.pdf = `${meta.type}/${id}.pdf`; out.push([dir + id + ".pdf", new Uint8Array(await files.pdf.arrayBuffer())]); }
  out.unshift([dir + id + ".json", JSON.stringify(rec, null, 1)]);
  return { blob: storeZip(out), name: `public_${id}.zip`, id };
}
/* ---------- public release through a GitHub issue (like the WWA board) ----------
   The studio packs the product (its summary for the products page plus what the public viewer needs)
   as gzip + base64 in a fenced block. The forecaster opens a prefilled issue in the private studio
   repository, pastes the release and submits; the "Publish public product" workflow checks it and
   pushes it to the public products repository with a deploy key. site.config.json names the repository. */
let SITE_CFG = null;
async function siteConfig(){
  if (SITE_CFG) return SITE_CFG;
  if (typeof window !== "undefined" && window.ERWX_SITE_CONFIG){ SITE_CFG = window.ERWX_SITE_CONFIG; return SITE_CFG; }
  try { SITE_CFG = await getJSON(`${typeof DATA_BASE !== "undefined" ? DATA_BASE : ""}site.config.json?ts=${Date.now()}`, 8000); } catch (e) { SITE_CFG = {}; }
  return SITE_CFG;
}
async function gzipB64(text){
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = new Uint8Array(await new Response(s).arrayBuffer()); let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin).replace(/(.{76})/g, "$1\n");
}
/* meta as for publicSnapshot; view: { kind:"planning-data", data } | { kind:"html", html } | { kind:"text", text } */
async function releaseBody(meta, view, by){
  if (!PUBLIC_TYPES.includes(meta.type)) throw new Error("This product type isn't cleared for the public page");
  const rel = { schema:2, ...meta, issued: new Date(meta.issued).toISOString(), audience:"public", releasedBy: by || meta.forecaster || "", view };
  const b64 = await gzipB64(JSON.stringify(rel));
  const when = new Date(meta.issued).toISOString().slice(0, 16).replace("T", " ") + "Z";
  return [`### Public release`, ``, `**Product:** ${meta.title}${meta.subtitle ? " (" + meta.subtitle + ")" : ""}`, `**Issued:** ${when}`,
    `**Released by:** ${by || meta.forecaster || "—"}, confirmed cleared for public release`, meta.headline ? `**Headline:** ${meta.headline}` : "", ``,
    `The studio wrote everything below; please don't edit it.`, ``, "```public-release", b64, "```", ``].filter(x => x !== null).join("\n");
}
/* ---------- GitHub connection (one-click publishing) ----------
   A fine-grained token limited to the studio repository with "Issues: Read and write" only lets the
   studio open the release or withdraw issue itself and watch for the workflow's answer. The token can't
   change code, data or the public site; the workflow still checks and publishes. Kept in this browser
   (localStorage when "remember" is ticked, otherwise for the session). */
const GH_KEY = "erwx:gh";
function ghToken(){ try { return (JSON.parse(localStorage.getItem(GH_KEY) || sessionStorage.getItem(GH_KEY) || "null") || {}).token || ""; } catch (e) { return ""; } }
function ghSave(token, remember, login){ const v = JSON.stringify({ token, login: login || "", saved: Date.now() }); try { localStorage.removeItem(GH_KEY); sessionStorage.removeItem(GH_KEY); (remember ? localStorage : sessionStorage).setItem(GH_KEY, v); } catch (e) { /* storage unavailable */ } }
function ghClear(){ try { localStorage.removeItem(GH_KEY); sessionStorage.removeItem(GH_KEY); } catch (e) { /* ignore */ } }
function ghRepo(cfg){ const m = String((cfg || {}).studioRepo || "").match(/github\.com\/([^/]+)\/([^/#?]+)/); return m && m[1] !== "ORG" ? { owner:m[1], repo:m[2].replace(/\.git$/, "") } : null; }
async function ghApi(path, opts = {}){
  const t = ghToken(); if (!t) throw Object.assign(new Error("Not connected to GitHub"), { status:0 });
  const r = await fetch(`https://api.github.com${path}`, { method: opts.method || "GET", headers:{ "Authorization":`Bearer ${t}`, "Accept":"application/vnd.github+json", "X-GitHub-Api-Version":"2022-11-28", ...(opts.body ? { "Content-Type":"application/json" } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (!r.ok){ let msg = ""; try { msg = (await r.json()).message || ""; } catch (e) { /* ignore */ } throw Object.assign(new Error(msg || `GitHub answered ${r.status}`), { status:r.status }); }
  return { data: r.status === 204 ? null : await r.json(), expires: r.headers.get("github-authentication-token-expiration") };
}
const ghWhy = e => e.status === 401 ? "GitHub didn't accept the token (it may have expired). Update it under GitHub connection."
  : e.status === 403 || e.status === 404 ? "The token can't open issues in the studio repository. Check it has access to that repository with Issues: Read and write, and that the organization approved it."
  : e.status === 0 ? e.message : `GitHub: ${e.message}`;
/* open a release or withdraw issue, then watch for the workflow's comment */
async function ghOpenIssue(title, body, labels){ const cfg = await siteConfig(), R = ghRepo(cfg); if (!R) throw Object.assign(new Error("Set studioRepo in docs/site.config.json"), { status:0 }); return (await ghApi(`/repos/${R.owner}/${R.repo}/issues`, { method:"POST", body:{ title, body, labels } })).data; }
async function ghWatch(issue, onStep, kind){
  const cfg = await siteConfig(), R = ghRepo(cfg), done = kind === "withdraw" ? /Withdrawn from the public page|Nothing to withdraw|Not withdrawn:|couldn't be updated/ : /Published to the public page|Not published:|couldn't be pushed/;
  const t0 = Date.now();
  while (Date.now() - t0 < 5*60e3){
    await new Promise(r => setTimeout(r, 5000));
    let cs = []; try { cs = (await ghApi(`/repos/${R.owner}/${R.repo}/issues/${issue.number}/comments?per_page=50`)).data || []; } catch (e) { onStep({ state:"error", text: ghWhy(e) }); return; }
    const last = cs.filter(c => /Published to the public page|Not published:|couldn't be pushed|Withdrawn from the public page|Nothing to withdraw|Not withdrawn:|couldn't be updated|Waiting for review/.test(c.body || "")).pop();
    if (last && /Waiting for review/.test(last.body)) onStep({ state:"wait", text:"Waiting for a second forecaster's review: it goes out when they remove the needs-review label." });
    else if (last && done.test(last.body)){ const ok = /^(Published|Withdrawn|Nothing to withdraw)/.test(last.body.trim()); const link = (last.body.match(/https?:\/\/\S+?(?=[\s)]|$)/) || [])[0]; onStep({ state: ok ? "done" : "error", text: last.body.replace(/\s*Note:.*$/s, "").replace(link || "\u0000", "").replace(/[:\s]+$/, ".").replace(/\.\.$/, "."), link }); return; }
    else onStep({ state:"run", text:`The workflow is checking it (${Math.round((Date.now() - t0)/1000)} s)…` });
  }
  onStep({ state:"slow", text:"It's taking longer than usual: follow it on the issue." });
}
/* the connection dialog */
async function showGitHubConnection(after){
  const cfg = await siteConfig(), R = ghRepo(cfg);
  let d = document.getElementById("ghDlg"); if (d) d.remove();
  d = document.createElement("dialog"); d.id = "ghDlg";
  d.style.cssText = "width:min(560px,94vw);border:1px solid #ccd;border-radius:12px;padding:20px 22px;font:14px/1.5 system-ui,sans-serif;color:inherit;background:var(--panel,#fff)";
  const saved = (() => { try { return JSON.parse(localStorage.getItem(GH_KEY) || sessionStorage.getItem(GH_KEY) || "null"); } catch (e) { return null; } })();
  d.innerHTML = `<h2 style="margin:0 0 6px;font-size:18px">GitHub connection</h2>
    <p style="margin:0 0 10px">With a connection, <b>Public copy</b> and <b>Withdraw</b> publish in one click: the studio opens the issue for you and shows when the workflow is done.</p>
    ${R ? `<ol style="margin:0 0 12px;padding-left:20px;font-size:13.5px">
      <li>On GitHub: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">create a fine-grained token</a>. Resource owner <b>${R.owner}</b>; repository access <b>Only select repositories → ${R.repo}</b>; permissions <b>Issues: Read and write</b> (nothing else); expiry 90 days or your policy.</li>
      <li>If the organization approves tokens, wait for the approval.</li>
      <li>Paste it below and press <b>Test and save</b>.</li></ol>` : `<p>Set <code>studioRepo</code> in <code>docs/site.config.json</code> first.</p>`}
    <label style="display:block;font-weight:600;margin:6px 0 4px">Token</label>
    <input id="ghTok" type="password" autocomplete="off" spellcheck="false" placeholder="${saved && saved.token ? "saved (paste a new one to replace it)" : "github_pat_…"}" style="width:100%;padding:8px 10px;border:1px solid #bbc;border-radius:8px;font:13px ui-monospace,Menlo,monospace">
    <label style="display:flex;gap:6px;align-items:center;margin:8px 0"><input type="checkbox" id="ghRem" ${!saved || localStorage.getItem(GH_KEY) ? "checked" : ""}> Remember on this computer (otherwise until the browser closes)</label>
    <p id="ghMsg" style="min-height:1.4em;margin:6px 0 12px;font-size:13.5px">${saved && saved.token ? `Connected${saved.login ? " as @" + saved.login : ""}.` : "Not connected."}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn primary" id="ghTest">Test and save</button><button type="button" class="btn" id="ghRemove">Remove</button><button type="button" class="btn" id="ghClose">Close</button></div>`;
  document.body.appendChild(d); d.showModal();
  const msg = t => d.querySelector("#ghMsg").textContent = t;
  d.querySelector("#ghClose").onclick = () => { d.close(); if (after) after(); };
  d.querySelector("#ghRemove").onclick = () => { ghClear(); msg("Removed. Releases use the copy-and-paste form."); };
  d.querySelector("#ghTest").onclick = async () => {
    const t = d.querySelector("#ghTok").value.trim() || ghToken(); if (!t){ msg("Paste a token first."); return; }
    if (!R){ msg("Set studioRepo in docs/site.config.json first."); return; }
    ghSave(t, d.querySelector("#ghRem").checked); msg("Testing…");
    try {
      const u = (await ghApi("/user")).data, rp = await ghApi(`/repos/${R.owner}/${R.repo}`);
      await ghApi(`/repos/${R.owner}/${R.repo}/issues?per_page=1&labels=public-release&state=all`);
      ghSave(t, d.querySelector("#ghRem").checked, u.login);
      msg(`Connected as @${u.login} to ${R.owner}/${R.repo}${rp.expires ? `; the token expires ${rp.expires.slice(0, 10)}` : ""}.`); d.querySelector("#ghTok").value = "";
    } catch (e) { ghClear(); msg(ghWhy(e)); }
  };
}
/* ---------- the official archive ----------
   With a GitHub connection, every issued planning forecast, TAF, mission weather product (page 1) and LMEF for
   a publicly announced launch is sent, compressed, as an "official-archive" issue to the studio repository;
   the Official archive workflow files it under docs/data/archive/<type>/<YYYY>/<MM>/ and closes the issue.
   Exposure and burn forecasts are never archived on GitHub (operation names and constraints). Without a
   connection nothing is sent; the browser's own copy stays as before. */
const ARCHIVE_TYPES = ["planning", "taf", "mwp", "lmef"];
async function archiveOfficial(meta, data){
  if (!ARCHIVE_TYPES.includes(meta.type) || typeof ghToken !== "function" || !ghToken()) return null;
  { const cfg = await siteConfig(); if (cfg.publicPage === false || cfg.archive === false) return null; }
  const say = m => { if (typeof toast === "function") toast(m); };
  try {
    const rec = { schema:1, type:meta.type, title:meta.title, subtitle:meta.subtitle || "", issued: new Date(meta.issued).toISOString(), forecaster: meta.forecaster || "", data };
    let b64 = await gzipB64(JSON.stringify(rec));
    if (b64.length > 60000 && data && data.for){ rec.data = { ...data, for:null, forTrimmed:true }; b64 = await gzipB64(JSON.stringify(rec)); }
    if (b64.length > 64000){ say("Not archived: the forecast is too large for the archive"); return null; }
    const when = rec.issued.slice(0, 16).replace("T", " ") + "Z";
    const body = [`### Official archive`, ``, `**Product:** ${meta.title}${meta.subtitle ? " (" + meta.subtitle + ")" : ""}`, `**Issued:** ${when}${meta.forecaster ? ` by ${meta.forecaster}` : ""}`, ``, "The studio wrote everything below; please don't edit it.", ``, "```official-archive", b64, "```", ``].join("\n");
    const iss = await ghOpenIssue(`Official archive: ${meta.title} ${when}${meta.forecaster ? " " + meta.forecaster : ""}`, body, ["official-archive"]);
    say("Sent to the official archive");
    return iss;
  } catch (e) { say("Not archived: " + ghWhy(e)); return null; }
}
/* send once per product version: exporting the same forecast as PDF, CSV and HTML archives it once */
const _archived = new Map();
function archiveOnce(key, meta, data, same){
  let h = 0; const s = JSON.stringify(same !== undefined ? same : data); for (let i = 0; i < s.length; i++) h = (h*31 + s.charCodeAt(i)) | 0;
  if (_archived.get(key) === h) return null; _archived.set(key, h);
  return archiveOfficial(meta, data);
}
/* reading the archive (served with the studio site): months.json lists the months; index/<YYYY-MM>.json
   lists that month's entries; each entry's file is gzip JSON */
async function archiveMonths(){ try { return await getJSON(`${DATA_BASE}data/archive/months.json?ts=${Date.now()}`, 10000); } catch (e) { return []; } }
async function archiveIndex(month){ try { return await getJSON(`${DATA_BASE}data/archive/index/${month}.json?ts=${Date.now()}`, 10000); } catch (e) { return []; } }
async function archiveFile(path){
  const r = await fetch(`${DATA_BASE}data/archive/${path}`, { cache:"force-cache" }); if (!r.ok) throw new Error(r.status);
  const s = r.body.pipeThrough(new DecompressionStream("gzip")); return JSON.parse(await new Response(s).text());
}
/* entries issued in the last `days`, optionally of one type, newest first */
async function archiveEntries(days, type){
  const months = (await archiveMonths()).slice().sort().reverse(), from = Date.now() - days*86400e3, out = [];
  for (const m of months){
    const [y, mo] = m.split("-").map(Number); if (Date.UTC(y, mo, 1) < from) break;
    for (const e of await archiveIndex(m)) if ((!type || e.type === type) && Date.parse(e.issued) >= from) out.push(e);
  }
  return out.sort((a, b) => Date.parse(b.issued) - Date.parse(a.issued));
}
/* the release dialog: copy the release, open the issue form, paste and submit (or download the ZIP instead) */
async function showReleaseDialog(meta, view, by, zipFn){
  const cfg = await siteConfig(), repo = (cfg.studioRepo || "").replace(/\/$/, ""), ok = repo && !/\/ORG\//.test(repo);
  const body = await releaseBody(meta, view, by);
  const when = new Date(meta.issued).toISOString().slice(0, 16).replace("T", " ") + "Z";
  const title = `Public release: ${meta.title} ${when}`;
  const direct = `${repo}/issues/new?labels=public-release&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  const short = direct.length < 7000;
  const url = short ? direct : `${repo}/issues/new?labels=public-release&title=${encodeURIComponent(title)}&body=${encodeURIComponent("Paste the release from the studio here (Ctrl+V or Cmd+V), replacing this line, then Submit.")}`;
  let d = document.getElementById("relDlg"); if (d) d.remove();
  d = document.createElement("dialog"); d.id = "relDlg";
  d.style.cssText = "max-width:560px;border:1px solid #ccd;border-radius:12px;padding:20px 22px;font:14px/1.5 system-ui,sans-serif;color:inherit;background:var(--panel,#fff)";
  const e2 = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  d.innerHTML = `<h2 style="margin:0 0 6px;font-size:18px">Release to the public page</h2><p style="margin:0 0 12px;color:var(--ink-2,#555)">${e2(meta.title)}${meta.subtitle ? " · " + e2(meta.subtitle) : ""}</p>
    ${ok ? `<ol style="margin:0 0 14px;padding-left:20px">${short ? `<li><b>Open the release form</b>: it opens on GitHub with everything filled in.</li><li>Check it and press <b>Submit new issue</b>.</li>` : `<li><b>Copy the release</b>.</li><li><b>Open the release form</b> on GitHub.</li><li>Click in the description, select its text and paste (Ctrl+V or Cmd+V), then press <b>Submit new issue</b>.</li>`}</ol>
      <p style="margin:0 0 14px;font-size:13px;color:var(--ink-3,#777)">The <i>Publish public product</i> workflow checks the release and puts it on the public page within a couple of minutes; it comments on the issue with the link.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${short ? "" : `<button type="button" class="btn" id="relCopy">Copy the release</button>`}<a class="btn primary" id="relOpen" href="${e2(url)}" target="_blank" rel="noopener">Open the release form</a><button type="button" class="btn" id="relZip">Download ZIP instead</button><button type="button" class="btn" id="relClose">Close</button></div>`
    : `<p>The studio doesn't know the GitHub repository yet: set <code>studioRepo</code> in <code>docs/site.config.json</code>. Until then, download the public copy as a ZIP and upload it to the products repository.</p><div style="display:flex;gap:8px"><button type="button" class="btn primary" id="relZip">Download ZIP</button><button type="button" class="btn" id="relClose">Close</button></div>`}`;
  document.body.appendChild(d); d.showModal();
  /* connected: publish in one click, then follow the workflow */
  if (ok && ghToken()){
    const ol = d.querySelector("ol"); if (ol) ol.remove();
    d.querySelector("p").insertAdjacentHTML("afterend", `<div id="relOne" style="border:1px solid var(--rule,#dde);border-radius:10px;padding:12px 14px;margin:0 0 12px"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button type="button" class="btn primary" id="relNow">Publish now</button><label style="display:flex;gap:6px;align-items:center;font-size:13.5px"><input type="checkbox" id="relRev"> Hold for a second forecaster's review</label></div><p id="relState" style="margin:8px 0 0;font-size:13.5px;color:var(--ink-2,#555)">The studio opens the release issue for you and shows when it's on the public page.</p></div>`);
    const open = d.querySelector("#relOpen"); if (open){ open.classList.remove("primary"); open.textContent = "Use the GitHub form instead"; }
    const cpy = d.querySelector("#relCopy"); if (cpy) cpy.hidden = true;
    d.querySelector("#relNow").onclick = async () => {
      const btn = d.querySelector("#relNow"), st = d.querySelector("#relState"); btn.disabled = true; st.textContent = "Opening the release issue…";
      const say = s => { st.innerHTML = `${s.state === "done" ? "✓ " : s.state === "error" ? "✗ " : ""}${e2(s.text)}${s.link ? ` <a href="${e2(s.link)}" target="_blank" rel="noopener">Open it</a>` : ""}`; st.style.color = s.state === "done" ? "var(--ok,#2F7D52)" : s.state === "error" ? "var(--bad,#B23A2E)" : ""; if (s.state === "error") btn.disabled = false; };
      try {
        const iss = await ghOpenIssue(title, body, d.querySelector("#relRev").checked ? ["public-release", "needs-review"] : ["public-release"]);
        st.innerHTML = `Release issue <a href="${e2(iss.html_url)}" target="_blank" rel="noopener">#${iss.number}</a> opened. The workflow is checking it…`;
        ghWatch(iss, s => { say(s); if (s.state !== "done" && s.state !== "error") st.insertAdjacentHTML("beforeend", ` <a href="${e2(iss.html_url)}" target="_blank" rel="noopener">issue #${iss.number}</a>`); }, "release");
      } catch (e) { say({ state:"error", text: ghWhy(e) }); }
    };
  } else if (ok){
    d.querySelector("#relClose").insertAdjacentHTML("beforebegin", `<button type="button" class="btn" id="relConnect" title="Publish in one click from now on">Connect GitHub</button>`);
    d.querySelector("#relConnect").onclick = () => { d.close(); showGitHubConnection(() => showReleaseDialog(meta, view, by, zipFn)); };
  }
  const copy = async () => { try { await navigator.clipboard.writeText(body); return true; } catch (e) { const ta = document.createElement("textarea"); ta.value = body; document.body.appendChild(ta); ta.select(); const r = document.execCommand("copy"); ta.remove(); return r; } };
  if (d.querySelector("#relCopy")) d.querySelector("#relCopy").onclick = async () => { const r = await copy(); d.querySelector("#relCopy").textContent = r ? "Copied" : "Copy failed: use the ZIP"; };
  if (d.querySelector("#relOpen") && !short) d.querySelector("#relOpen").addEventListener("click", () => { copy(); });
  d.querySelector("#relZip").onclick = () => { zipFn && zipFn(); d.close(); };
  d.querySelector("#relClose").onclick = () => d.close();
  return { body, url };
}
/* ---------- the public page manager: what's live, and withdrawing it ----------
   Lists the public page's products (read from its index) and opens a prefilled issue labelled
   "public-withdraw" for a version or a whole product; the workflow removes it with the deploy key. */
async function showPublicManager(){
  const cfg = await siteConfig(), repo = (cfg.studioRepo || "").replace(/\/$/, ""), page = (cfg.productsPage || "").replace(/\/?$/, "/");
  const ok = repo && !/\/ORG\//.test(repo) && page && !/\/\/ORG\./.test(page);
  let d = document.getElementById("pubMgr"); if (d) d.remove();
  d = document.createElement("dialog"); d.id = "pubMgr";
  d.style.cssText = "width:min(720px,94vw);max-height:86vh;border:1px solid #ccd;border-radius:12px;padding:20px 22px;font:14px/1.5 system-ui,sans-serif;color:inherit;background:var(--panel,#fff)";
  const e2 = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  d.innerHTML = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="margin:0;font-size:18px;flex:1">Public page</h2>${ok ? `<a class="btn" href="${e2(page)}" target="_blank" rel="noopener">Open the public page</a>` : ""}<button type="button" class="btn" id="pmGh">${ghToken() ? "GitHub connection" : "Connect GitHub"}</button><button type="button" class="btn" id="pmClose">Close</button></div><div id="pmBody" style="margin-top:12px"><p>Loading…</p></div>`;
  document.body.appendChild(d); d.showModal();
  d.querySelector("#pmClose").onclick = () => d.close();
  d.querySelector("#pmGh").onclick = () => { d.close(); showGitHubConnection(() => showPublicManager()); };
  /* connected: withdraw in one click and follow the workflow; otherwise the links open GitHub's form */
  d.addEventListener("click", async ev => {
    const a = ev.target.closest("a[data-wd]"); if (!a || !ghToken()) return;
    ev.preventDefault();
    if (!confirm(a.dataset.scope === "product" ? "Withdraw every version of this product from the public page?" : "Withdraw this version from the public page?")) return;
    const q = new URLSearchParams(a.getAttribute("href").split("?")[1]), row = a.closest("[data-wrow]") || a.parentElement;
    let st = row.querySelector(".wdst"); if (!st){ st = document.createElement("div"); st.className = "wdst"; st.style.cssText = "font-size:13px;margin-top:4px"; row.appendChild(st); }
    st.textContent = "Opening the withdraw issue…";
    try {
      const iss = await ghOpenIssue(q.get("title"), q.get("body"), ["public-withdraw"]);
      ghWatch(iss, s => { st.innerHTML = `${s.state === "done" ? "✓ " : s.state === "error" ? "✗ " : ""}${e2(s.text)} <a href="${e2(iss.html_url)}" target="_blank" rel="noopener">issue #${iss.number}</a>`; st.style.color = s.state === "done" ? "var(--ok,#2F7D52)" : s.state === "error" ? "var(--bad,#B23A2E)" : ""; }, "withdraw");
    } catch (e) { st.textContent = "✗ " + ghWhy(e); st.style.color = "var(--bad,#B23A2E)"; }
  });
  const body = d.querySelector("#pmBody");
  if (!ok){ body.innerHTML = `<p>Set <code>studioRepo</code> and <code>productsPage</code> in <code>docs/site.config.json</code> to manage the public page from here.</p>`; return; }
  /* the public site's own list first; if it can't be read from here (a private Pages site only answers its own
     signed-in visitors), the studio's copy, kept current by the "Mirror public list" workflow job */
  let idx = null, fromCopy = false;
  try { idx = await getJSON(`${page}products/index.json?ts=${Date.now()}`, 12000); } catch (e) { idx = null; }
  if (!idx || !Array.isArray(idx.products)){
    try { idx = await getJSON(`${typeof DATA_BASE !== "undefined" ? DATA_BASE : ""}data/public_index.json?ts=${Date.now()}`, 10000); fromCopy = true; } catch (e) { idx = null; }
  }
  if (!idx || !Array.isArray(idx.products)){ body.innerHTML = "<p>The public page's product list couldn't be read, and the studio has no copy yet. Run <b>Actions → Publish public product → Run workflow</b> once to make the copy, or release a product.</p>"; return; }
  const ps = idx.products || [];
  if (!ps.length){ body.innerHTML = "<p>Nothing is on the public page.</p>"; return; }
  const when = iso => { const t = new Date(iso); return isNaN(t) ? "" : t.toISOString().slice(0, 16).replace("T", " ") + "Z"; };
  const withdrawUrl = (p, scope, id, iss) => {
    const req = { action:"withdraw", scope, type:p.type, key:p.key, id: id || p.id };
    const title = scope === "product" ? `Withdraw from public page: ${p.title} (all versions)` : `Withdraw from public page: ${p.title} ${when(iss)}`;
    const b = [`### Withdraw from the public page`, ``, `**Product:** ${p.title}${p.subtitle ? " (" + p.subtitle + ")" : ""}`, scope === "product" ? `**Remove:** every version` : `**Remove:** the version issued ${when(iss)}`, `**Reason:** (optional, type it here)`, ``, `The studio wrote the block below; please don't edit it.`, ``, "```public-withdraw", JSON.stringify(req), "```"].join("\n");
    return `${repo}/issues/new?labels=public-withdraw&title=${encodeURIComponent(title)}&body=${encodeURIComponent(b)}`;
  };
  body.innerHTML = `<p style="margin:0 0 10px;color:var(--ink-2,#555)">${ghToken() ? "Withdrawing opens the withdraw issue for you and shows when the product is gone (a couple of minutes)." : "Withdrawing opens a prefilled issue in the studio repository; submit it and the workflow removes the product within a couple of minutes."} Removing the current version brings back the previous one.</p>${fromCopy ? `<p style="margin:0 0 10px;font-size:13px;color:var(--ink-3,#777)">From the studio's copy of the list, updated ${e2(when(idx.updated))}; changes in the last few minutes may not show yet.</p>` : ""}` + ps.map(p => `
    <div style="border:1px solid var(--rule,#dde);border-radius:10px;padding:10px 12px;margin:8px 0">
      <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><b>${e2(p.title)}</b><span style="color:var(--ink-3,#777)">${e2(p.subtitle || "")}</span><span style="flex:1"></span><a class="btn" data-wd="1" data-scope="product" href="${e2(withdrawUrl(p, "product"))}" target="_blank" rel="noopener">Withdraw the whole product</a></div>
      <table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:13px">
        <tr data-wrow="1"><td style="padding:3px 0">Current: ${e2(when(p.issued))}${p.forecaster ? " by " + e2(p.forecaster) : ""}</td><td style="text-align:right"><a data-wd="1" data-scope="version" href="${e2(withdrawUrl(p, "version", p.id, p.issued))}" target="_blank" rel="noopener">Withdraw this version</a></td></tr>
        ${(p.history || []).map(h => `<tr data-wrow="1"><td style="padding:3px 0;color:var(--ink-2,#555)">Earlier: ${e2(when(h.issued))}${h.forecaster ? " by " + e2(h.forecaster) : ""}</td><td style="text-align:right"><a data-wd="1" data-scope="version" href="${e2(withdrawUrl(p, "version", h.id, h.issued))}" target="_blank" rel="noopener">Withdraw this version</a></td></tr>`).join("")}
      </table></div>`).join("");
}
/* editions: site.config.json { "publicPage": false } is the personal edition: no public page, releases,
   withdrawals, GitHub connection or official archive (the controls are hidden, the archive never sent) */
if (typeof document !== "undefined"){
  const st = document.createElement("style");
  st.textContent = `.erwx-nopublic #tafPublic, .erwx-nopublic #lmPublic, .erwx-nopublic #pubBtn, .erwx-nopublic .pubpub, .erwx-nopublic #pubMgrLink, .erwx-nopublic label:has(#lmPubLaunch){ display:none !important; }
    .erwx-noarchive label:has(#lmPubLaunch){ display:none !important; }`;
  document.head.appendChild(st);
  siteConfig().then(cfg => { if (cfg.publicPage === false) document.documentElement.classList.add("erwx-nopublic"); if (cfg.archive === false) document.documentElement.classList.add("erwx-noarchive"); });
}
/* a "Public page" entry in the studio's page bar */
if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", async () => {
  if ((await siteConfig()).publicPage === false) return;
  const nav = document.querySelector("nav.pagenav"); if (!nav || document.getElementById("pubMgrLink")) return;
  const a = document.createElement("a"); a.href = "#"; a.id = "pubMgrLink"; a.textContent = "Public page"; a.title = "What's on the public page, and withdrawing it";
  a.onclick = ev => { ev.preventDefault(); showPublicManager(); };
  nav.appendChild(a);
});
/* ---------- shared PDF helpers (planning, exposure, burn, LMEF and MWP pages) ---------- */
const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const textW = (s, size, bold) => { let w = 0; for (const ch of String(s)){ const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? HW[c - 32] : ch === "–" ? 556 : ch === "°" ? 400 : 556; } return w*size/1000*(bold ? 1.06 : 1); };
const pdfStr = s => "(" + [...String(s)].map(ch => { if (ch === "(" || ch === ")" || ch === "\\") return "\\" + ch; if (ch === "–") return "\\226"; if (ch === "—") return "\\227"; if (ch === "°") return "\\260"; if (ch === "•") return "\\225"; if (ch === "·") return "\\267"; if (ch === "≥") return ">="; if (ch === "≤") return "<="; if (ch === "’") return "\\222"; if (ch === "‘") return "\\221"; if (ch === "“") return "\\223"; if (ch === "”") return "\\224"; if (ch === "¹") return "\\271"; if (ch === "²") return "\\262"; const c = ch.charCodeAt(0); return c < 32 || c > 126 ? "?" : ch; }).join("") + ")";
async function decodeImage(bytes, type){
  const img = await createImageBitmap(new Blob([bytes], { type: type || "image/png" }));
  const rh = 200, rw = Math.round(img.width*rh/img.height);
  const c = document.createElement("canvas"); c.width = rw; c.height = rh;
  const x = c.getContext("2d"); x.drawImage(img, 0, 0, rw, rh);
  const d = x.getImageData(0, 0, rw, rh).data, rgb = new Uint8Array(rw*rh*3), alpha = new Uint8Array(rw*rh);
  for (let i = 0, j = 0, k = 0; i < d.length; i += 4, k++){ rgb[j++] = d[i]; rgb[j++] = d[i + 1]; rgb[j++] = d[i + 2]; alpha[k] = d[i + 3]; }
  return { w: img.width, h: img.height, rgb, alpha, rw, rh };
}
function pdfAssemble(pages, logo, W, Hp, opts){
  opts = opts || {};
  /* assemble objects */
  const objs = [];
  const add = s => { objs.push(s); return objs.length; };
  const fontR = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontB = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const fontI = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>");
  const fontBI = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >>");
  const im2 = opts.image2 ? (() => { const g = opts.image2; const sm = g.alpha ? add({ head:`<< /Type /XObject /Subtype /Image /Width ${g.rw} /Height ${g.rh} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${g.alpha.length} >>\nstream\n`, bin:g.alpha, tail:"\nendstream" }) : null; return add({ head:`<< /Type /XObject /Subtype /Image /Width ${g.rw} /Height ${g.rh} /ColorSpace /DeviceRGB /BitsPerComponent 8${sm ? ` /SMask ${sm} 0 R` : ""} /Length ${g.rgb.length} >>\nstream\n`, bin:g.rgb, tail:"\nendstream" }); })() : null;
  const annots = (opts.links || []).map(l => ({ page:l.page || 0, id: add(`<< /Type /Annot /Subtype /Link /Rect [${l.x.toFixed(1)} ${(Hp - l.y - l.h).toFixed(1)} ${(l.x + l.w).toFixed(1)} ${(Hp - l.y).toFixed(1)}] /Border [0 0 0] /A << /S /URI /URI (${l.url}) >> >>`) }));
  const smask = logo && logo.alpha ? add({ head:`<< /Type /XObject /Subtype /Image /Width ${logo.rw} /Height ${logo.rh} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${logo.alpha.length} >>\nstream\n`, bin:logo.alpha, tail:"\nendstream" }) : null;
  const img = logo ? add({ head:`<< /Type /XObject /Subtype /Image /Width ${logo.rw} /Height ${logo.rh} /ColorSpace /DeviceRGB /BitsPerComponent 8${smask ? ` /SMask ${smask} 0 R` : ""} /Length ${logo.rgb.length} >>\nstream\n`, bin:logo.rgb, tail:"\nendstream" }) : null;
  const pagesId = objs.length + 1 + pages.length*2;   /* reserved after page objects */
  const kids = [];
  pages.forEach((c, pi) => {
    const sid = add(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
    const an = annots.filter(a => a.page === pi).map(a => a.id + " 0 R");
    const xo = [img ? `/Im1 ${img} 0 R` : "", im2 ? `/Im2 ${im2} 0 R` : ""].filter(Boolean).join(" ");
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${Hp}] /Resources << /Font << /F1 ${fontR} 0 R /F2 ${fontB} 0 R /F3 ${fontI} 0 R /F4 ${fontBI} 0 R >>${xo ? ` /XObject << ${xo} >>` : ""} >>${an.length ? ` /Annots [${an.join(" ")}]` : ""} /Contents ${sid} 0 R >>`));
  });
  add(`<< /Type /Pages /Kids [${kids.map(k => k + " 0 R").join(" ")}] /Count ${kids.length} >>`);
  const cat = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const parts = []; let pos = 0;
  const putS = str => { const b = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xFF; parts.push(b); pos += b.length; };
  const putB = b => { parts.push(b); pos += b.length; };
  const offs = [];
  putS("%PDF-1.4\n");
  objs.forEach((o, i) => {
    offs.push(pos);
    if (typeof o === "string") putS(`${i + 1} 0 obj\n${o}\nendobj\n`);
    else { putS(`${i + 1} 0 obj\n${o.head}`); putB(o.bin); putS(`${o.tail}\nendobj\n`); }
  });
  const xref = pos;
  putS(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join(""));
  putS(`trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type:"application/pdf" });
}
