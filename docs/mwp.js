"use strict";
/* ============================================================
   Mission Weather Products (MWP): the PSFB (KCOF) and NASA SLF (KTTS) mission execution forecasts.
   Take-off/landing data come from the station TAF (the TAF generator draft or the latest issued
   TAF), so the product stays consistent with it; temperatures, altimeter, flight-level winds and the
   freezing level come from the models; sun and moon times are computed here; ocean data come from
   the Open-Meteo marine model. Everything the forecaster types stays on this computer.
   ============================================================ */
const $ = id => document.getElementById(id);
const DEMO = /[?&]demo=1\b/.test(location.search) || !!window.FORCE_DEMO;
const LSM = "mwpfx:v1";
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const p2 = n => String(n).padStart(2, "0");
const store = { get(k, d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full */ } } };

/* ---------- products ---------- */
const PROD = {
  psfb: { key:"psfb", title:"PATRICK SPACE FORCE BASE MISSION EXECUTION FORECAST", short:"PSFB MWP", stn:"KCOF", place:"PSFB (KCOF)", lat:28.2349, lon:-80.6101, elev:9,
    rwys:[["R03/21", 24], ["R11/29", 104]], rh:true, civil:true, moonAlt:false, alts:["KTIX","KMLB","KSFB"], dz:true },
  nasa: { key:"nasa", title:"KENNEDY SPACE CENTER MISSION EXECUTION FORECAST", short:"NASA MWP", stn:"KTTS", place:"KENNEDY SPACE CENTER (KTTS)", lat:28.6150, lon:-80.6945, elev:10,
    rwys:[["R15/33", 144]], rh:true, civil:false, moonAlt:true, alts:["KTIX","KMLB","KSFB","KCOF"], dz:false },
};
const BUOY = { id:"41009", name:"Farshore 41009", lat:28.519, lon:-80.166 };
/* drop zones: names only. Positions are not in this code (it is public): each forecaster loads them
   once from a positions file, and they stay in this browser and in workspace files. */
const DZS = [
  { id:"ferreira", g:"920", name:"Ferreira" },
  { id:"bambam",   g:"920", name:"Bam Bam/Judy" },
  { id:"ar15v",    g:"920", name:"AR15V", kind:"air refueling track" },
  { id:"avon",     g:"920", name:"Avon Park/Hardluck" },
  { id:"armarian", g:"920", name:"AR Marian", kind:"air refueling area" },
  { id:"kathy",    g:"920", name:"Kathy (water DZ)", water:true },
  { id:"site11",   g:"dos", name:"Site 11" },
  { id:"northlz",  g:"dos", name:"North LZ" },
  { id:"cowpie",   g:"dos", name:"Cowpie" },
  { id:"bridge",   g:"dos", name:"Bridge/Picnic" },
  { id:"reno",     g:"dos", name:"Reno" },
  { id:"southlz",  g:"dos", name:"South LZ" },
];
const HAZ = [
  { id:"none",  c:"green",  t:"No hazards" },
  { id:"turb",  c:"yellow", t:"Non-convective light-moderate turbulence below FL180" },
  { id:"ice",   c:"yellow", t:"Non-convective light-moderate icing below FL180" },
  { id:"vcts",  c:"yellow", t:"Vicinity thunderstorms" },
  { id:"sev",   c:"red",    t:"Non-convective severe turbulence/icing below FL180" },
  { id:"ts",    c:"red",    t:"Thunderstorms on DZ" },
];
const HCOL = { green:"#2F9E57", yellow:"#F2C230", red:"#D33B30" };
const BLOCKS = { DTAC:[8, 17], NTAC:[16, 24], OTAC:[0, 6] };

const M = Object.assign({ prod:"psfb", block:"DTAC", blocks:{ ...BLOCKS }, date:null, fc:"", mef:"", flHour:null, wwa:{ watch:"", warning:"", advisory:"" },
  tafSrc:"auto", ov:{}, dz:{}, dzPos:{}, dzDisc:"", altPaste:{} }, store.get(LSM, {}));
const save = () => store.set(LSM, M);
const PR = () => PROD[M.prod];
const G = { taf:null, tafText:"", tafFrom:"", alts:{}, wx:null, dz:null, sea:null, buoys:null, cwf:null, status:{} };
/* marine: buoy observations (NDBC, mirrored by the MOS workflow) and the NWS coastal waters forecast */
const CWF_FOR = { buoy:"AMZ572", kathy:"AMZ552" };
const NEAR_BUOY = { buoy:"41009", kathy:"41113" };
async function fetchMarineObs(){
  if (DEMO) return demoMarine();
  const [b, c] = await Promise.all([
    getJSON(`${DATA_BASE}data/buoys.json?ts=${Date.now()}`, 10000).catch(() => null),
    getJSON(`${DATA_BASE}data/cwf.json?ts=${Date.now()}`, 10000).catch(() => null),
  ]);
  let cwf = c && c.zones ? c.zones : null;
  if (!cwf){
    /* no mirror yet: ask the NWS directly */
    cwf = {};
    for (const z of [...new Set(Object.values(CWF_FOR))]){
      try { const js = await getJSON(`https://api.weather.gov/zones/forecast/${z}/forecast`, 15000); cwf[z] = { periods: ((js.properties || {}).periods || []).map(p => ({ name:p.name, text:p.detailedForecast })), updated:(js.properties || {}).updated }; } catch (e) { /* unavailable */ }
    }
    if (!Object.keys(cwf).length) cwf = null;
  }
  return { buoys: b && b.buoys ? b.buoys : null, cwf };
}
/* the coastal waters period for the chosen date and block (day or night) */
function cwfPeriod(zone){
  const Z = G.cwf && G.cwf[zone]; if (!Z || !Z.periods || !Z.periods.length) return null;
  const [y, mo, d] = (M.date || todayLocal()).split("-").map(Number), night = M.blocks[M.block][0] >= 15 || M.blocks[M.block][1] <= 6;
  const wd = new Date(Date.UTC(y, mo - 1, d, 12)).toLocaleDateString("en-US", { weekday:"long", timeZone:"UTC" }), today = (M.date || todayLocal()) === todayLocal();
  const names = night ? (today ? ["Tonight", "Overnight", `${wd} Night`] : [`${wd} Night`]) : (today ? ["Today", "This Afternoon", "Rest Of Today", "This Morning", wd] : [wd]);
  const p = Z.periods.find(q => names.some(n => (q.name || "").toLowerCase() === n.toLowerCase())) || Z.periods.find(q => (q.name || "").toLowerCase().startsWith(wd.toLowerCase()) && /night/i.test(q.name) === night);
  if (!p) return null;
  const tx = p.text || "", sm = tx.match(/seas\s+(?:around\s+|less than\s+)?(\d+)(?:\s+to\s+(\d+))?\s+(?:ft|feet)/i), wdm = tx.match(/wave detail:\s*([^.]+)/i), wm = tx.match(/((?:north|south|east|west)(?:\s*(?:north|south|east|west))*)\s+winds?\s+(?:around\s+)?(\d+)(?:\s+to\s+(\d+))?\s+(?:kt|knots)/i);
  return { zone, name:p.name, text:tx, seas: sm ? (sm[2] ? `${sm[1]}-${sm[2]} FT` : `${sm[1]} FT`) : null, detail: wdm ? wdm[1].trim() : null, wind: wm ? `${wm[1].toLowerCase()} ${wm[2]}${wm[3] ? "-" + wm[3] : ""} kt` : null };
}
/* the latest buoy observation */
function buoyObs(id){
  const B = G.buoys && G.buoys[id]; if (!B || !B.obs || !B.obs.length) return null;
  const o = B.obs.find(x => x.wvht_m != null || x.wtmp_c != null) || B.obs[0], t = Date.parse(o.t);
  return { id, name:B.name, t, age:(Date.now() - t)/H, wave: o.wvht_m != null ? o.wvht_m*3.28084 : null, per:o.dpd_s, dir:o.mwd, wtmp: o.wtmp_c != null ? o.wtmp_c*9/5 + 32 : null, wind: o.wspd_ms != null ? `${o.wdir != null ? String(Math.round(o.wdir/10)*10).padStart(3, "0") : "VRB"}${p2(Math.round(o.wspd_ms*1.943844))}${o.gst_ms != null ? "G" + p2(Math.round(o.gst_ms*1.943844)) : ""}KT` : null };
}
const obsText = o => !o ? "" : `${o.id} ${new Date(o.t).toISOString().slice(11, 16).replace(":", "")}Z: ${o.wave != null ? `seas ${o.wave.toFixed(1)} ft` : "no wave data"}${o.per ? ` at ${Math.round(o.per)} s` : ""}${o.wind ? `, wind ${o.wind}` : ""}${o.wtmp != null ? `, water ${Math.round(o.wtmp)}F` : ""}${o.age > 3 ? " (old)" : ""}`;
const nwsText = c => !c ? "" : `${c.seas ? "seas " + c.seas.toLowerCase() : "no seas given"}${c.detail ? ", " + c.detail : ""}${c.wind ? "; " + c.wind : ""} (NWS ${c.zone}, ${c.name})`;
/* what goes in the product's wave height and sea temperature: NWS seas, buoy water temperature, model as the fallback */
function seaSummary(where){
  const c = cwfPeriod(CWF_FOR[where]), o = buoyObs(NEAR_BUOY[where]), m = seaAt(where === "buoy" ? "buoy" : "kathy", M.flHour);
  return { wave: c && c.seas ? c.seas : m ? waveText(m.wave) : "", waveSrc: c && c.seas ? "NWS" : m ? "model" : "",
    sst: o && o.wtmp != null && o.age < 6 ? Math.round(o.wtmp) : m && m.sst != null ? Math.round(m.sst) : null, sstSrc: o && o.wtmp != null && o.age < 6 ? `${o.id} obs` : m ? "model" : "",
    nws: c, obs: o, model: m };
}

/* ---------- time ---------- */
const tzParts = t => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone:TZ, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
function localToUTC(y, mo, d, h, mi){ let t = Date.UTC(y, mo - 1, d, h, mi || 0); for (let k = 0; k < 3; k++){ const p = tzParts(t); t += Date.UTC(y, mo - 1, d, h, mi || 0) - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute); } return t; }
const todayLocal = () => { const p = tzParts(Date.now()); return `${p.year}-${p.month}-${p.day}`; };
function blockRange(){
  const [y, mo, d] = (M.date || todayLocal()).split("-").map(Number), [a, b] = M.blocks[M.block] || BLOCKS[M.block];
  return { a: localToUTC(y, mo, d, 0, 0) + a*H, b: localToUTC(y, mo, d, 0, 0) + b*H };   /* hours after local midnight (24 = next midnight) */
}
const lHM = t => { const p = tzParts(t + 30e3); return `${p.hour}${p.minute}`; };
const lH = t => tzParts(t).hour;
const zH = t => p2(new Date(t).getUTCHours());
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const dateLabel = () => { const [y, mo, d] = (M.date || todayLocal()).split("-").map(Number); return `${p2(d)}-${MON[mo - 1]}-${String(y).slice(2)}`; };

/* ---------- TAF parsing ---------- */
const WX_TOK = /^(\+|-|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)*$/;
function parseTAF(text, refYear, refMonth){
  const toks = String(text || "").replace(/=/g, " ").split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  let i = 0; if (toks[i] === "TAF") i++; if (toks[i] === "AMD" || toks[i] === "COR") i++;
  const stn = toks[i++]; if (!/^[A-Z]{4}$/.test(stn || "")) return null;
  let issue = null; if (/^\d{6}Z$/.test(toks[i] || "")){ issue = toks[i]; i++; }
  const vp = toks[i] && toks[i].match(/^(\d{2})(\d{2})\/(\d{2})(\d{2})$/); if (!vp) return null; i++;
  const ref = refYear && refMonth ? { y:refYear, m:refMonth } : (() => { const d = new Date(); return { y:d.getUTCFullYear(), m:d.getUTCMonth() + 1 }; })();
  const at = (dd, hh, mm) => { let t = Date.UTC(ref.y, ref.m - 1, +dd, +hh, +(mm || 0)); const now = Date.UTC(ref.y, ref.m - 1, 15); if (t - now > 20*86400e3) t = Date.UTC(ref.y, ref.m - 2, +dd, +hh, +(mm || 0)); if (now - t > 20*86400e3) t = Date.UTC(ref.y, ref.m, +dd, +hh, +(mm || 0)); return t; };
  const from = at(vp[1], vp[2]), to = at(vp[3], vp[4]);
  const groups = []; let cur = { type:"BASE", a:from, b:to, raw:[] }; groups.push(cur);
  for (; i < toks.length; i++){
    const t = toks[i];
    let m;
    if ((m = t.match(/^FM(\d{2})(\d{2})(\d{2})$/))){ cur = { type:"FM", a:at(m[1], m[2], m[3]), b:to, raw:[t] }; groups.push(cur); continue; }
    if (t === "BECMG" || t === "TEMPO" || /^PROB\d{2}$/.test(t)){
      const pr = /^PROB/.test(t) ? t : null; let type = pr ? "PROB" : t; let j = i + 1;
      if (pr && toks[j] === "TEMPO"){ type = "TEMPO"; j++; }
      const w = toks[j] && toks[j].match(/^(\d{2})(\d{2})\/(\d{2})(\d{2})$/);
      if (w){ cur = { type, a:at(w[1], w[2]), b:at(w[3], w[4]), raw:[t], prob:pr }; groups.push(cur); i = j; continue; }
    }
    cur.raw.push(t);
    if ((m = t.match(/^(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT$/))){ cur.wind = { d: m[1] === "VRB" ? null : +m[1], s:+m[2], g: m[3] ? +m[3] : null, vrb: m[1] === "VRB", raw:t }; continue; }
    if (/^\d{4}$/.test(t) && !/^\d{4}\/\d{4}$/.test(t)){ cur.vis = +t; continue; }
    if ((m = t.match(/^(P)?(\d+)(?:\/(\d))?SM$/))){ const v = m[3] ? +m[2]/+m[3] : +m[2]; cur.vis = m[1] ? 9999 : Math.round(v*1609.34); continue; }
    if ((m = t.match(/^(\d)\s*$/))) continue;
    if ((m = t.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/))){ (cur.sky = cur.sky || []).push({ c:m[1], h:+m[2]*100, cb:m[3] || "" }); continue; }
    if (/^(SKC|NSC|CLR|NCD)$/.test(t)){ cur.sky = []; cur.skyClear = t; continue; }
    if ((m = t.match(/^QNH(\d{4})INS$/))){ cur.qnh = +m[1]/100; continue; }
    if (t === "NSW"){ cur.wx = []; cur.nsw = true; continue; }
    if (t !== "AMD" && t !== "NOT" && t !== "SKED" && !/^T[XN]/.test(t) && WX_TOK.test(t) && t.length >= 2){ (cur.wx = cur.wx || []).push(t); continue; }
  }
  return { stn, issue, from, to, groups };
}
/* prevailing conditions for an hour [t, t+1h): base, then FM (replaces all) and BECMG (replaces what it gives) */
function stateAt(taf, t){
  if (!taf) return null;
  const st = {};
  for (const g of taf.groups){
    if (g.type === "BASE" || (g.type === "FM" && g.a <= t)){ if (g.type === "FM") for (const k of ["wind","vis","wx","sky","skyClear"]) delete st[k]; for (const k of ["wind","vis","wx","sky","skyClear","qnh"]) if (g[k] !== undefined) st[k] = g[k]; }
    else if (g.type === "BECMG" && g.a <= t){ for (const k of ["wind","vis","wx","sky","skyClear","qnh"]) if (g[k] !== undefined) st[k] = g[k]; }
  }
  const tempo = taf.groups.filter(g => (g.type === "TEMPO" || g.type === "PROB") && g.a < t + H && g.b > t);
  return { ...st, tempo };
}
/* flight category from ceiling and visibility */
const CATS = [["LIFR","#B23AAE"],["IFR","#D33B30"],["MVFR","#2D6FD6"],["VFR","#2F9E57"]];
function category(st){
  if (!st) return null;
  const ceil = (st.sky || []).filter(l => l.c === "BKN" || l.c === "OVC" || l.c === "VV").map(l => l.h).sort((a, b) => a - b)[0] ?? 99999;
  const vsm = st.vis == null ? 10 : st.vis >= 9999 ? 10 : st.vis/1609.34;
  if (ceil < 500 || vsm < 1) return "LIFR"; if (ceil < 1000 || vsm < 3) return "IFR"; if (ceil <= 3000 || vsm <= 5) return "MVFR"; return "VFR";
}
const catColor = c => (CATS.find(x => x[0] === c) || [0, "#7D8B97"])[1];
const SM_STEPS = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 10];
const visSM = m => m == null ? "" : m >= 9999 ? "10SM" : (() => { const v = m/1609.34; const s = SM_STEPS.reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a); return (s === 0.25 ? "1/4" : s === 0.5 ? "1/2" : s === 0.75 ? "3/4" : s === 1.5 ? "1 1/2" : s === 2.5 ? "2 1/2" : String(s)) + "SM"; })();
const skyText = st => !st ? "" : st.sky && st.sky.length ? st.sky.map(l => `${l.c}${p2(Math.round(l.h/100)).padStart(3, "0")}${l.cb}`).join(" ") : (st.skyClear || "SKC");
const windText = w => !w ? "" : `${w.vrb ? "VRB" : String(w.d).padStart(3, "0")}${p2(w.s)}${w.g ? "G" + p2(w.g) : ""}`;
const wxText = st => !st ? "" : st.wx && st.wx.length ? st.wx.join(" ") : "NSW";
function xwind(w, hdg){ if (!w || w.vrb || w.d == null) return null; const sp = w.g || w.s; return Math.round(Math.abs(sp*Math.sin((w.d - hdg)*Math.PI/180))); }

/* ---------- sun and moon (after V. Agafonkin's SunCalc, BSD) ---------- */
const RAD = Math.PI/180, DAYMS = 86400e3, J1970 = 2440588, J2000 = 2451545, OBL = RAD*23.4397;
const toJulian = d => d/DAYMS - 0.5 + J1970, fromJulian = j => (j + 0.5 - J1970)*DAYMS, toDays = d => toJulian(d) - J2000;
const rightAsc = (l, b) => Math.atan2(Math.sin(l)*Math.cos(OBL) - Math.tan(b)*Math.sin(OBL), Math.cos(l));
const declin = (l, b) => Math.asin(Math.sin(b)*Math.cos(OBL) + Math.cos(b)*Math.sin(OBL)*Math.sin(l));
const azim = (H2, phi, dec) => Math.atan2(Math.sin(H2), Math.cos(H2)*Math.sin(phi) - Math.tan(dec)*Math.cos(phi));
const altit = (H2, phi, dec) => Math.asin(Math.sin(phi)*Math.sin(dec) + Math.cos(phi)*Math.cos(dec)*Math.cos(H2));
const sidereal = (d, lw) => RAD*(280.16 + 360.9856235*d) - lw;
const solarMA = d => RAD*(357.5291 + 0.98560028*d);
const eclLong = Mn => { const C = RAD*(1.9148*Math.sin(Mn) + 0.02*Math.sin(2*Mn) + 0.0003*Math.sin(3*Mn)); return Mn + C + RAD*102.9372 + Math.PI; };
function sunTimes(date, lat, lng){
  const lw = RAD*-lng, phi = RAD*lat, d = toDays(date), n = Math.round(d - 0.0009 - lw/(2*Math.PI)), ds = 0.0009 + lw/(2*Math.PI) + n;
  const Mn = solarMA(ds), L = eclLong(Mn), dec = declin(L, 0), Jnoon = J2000 + ds + 0.0053*Math.sin(Mn) - 0.0069*Math.sin(2*L);
  const set = h => { const w = Math.acos((Math.sin(h) - Math.sin(phi)*Math.sin(dec))/(Math.cos(phi)*Math.cos(dec))); const a = 0.0009 + (w + lw)/(2*Math.PI) + n; return J2000 + a + 0.0053*Math.sin(Mn) - 0.0069*Math.sin(2*L); };
  const out = {};
  for (const [ang, r, s] of [[-0.833, "sunrise", "sunset"], [-6, "civilBegin", "civilEnd"], [-12, "nautBegin", "nautEnd"]]){ const Jset = set(ang*RAD), Jrise = Jnoon - (Jset - Jnoon); out[r] = fromJulian(Jrise); out[s] = fromJulian(Jset); }
  return out;
}
function moonCoords(d){ const L = RAD*(218.316 + 13.176396*d), Mn = RAD*(134.963 + 13.064993*d), F = RAD*(93.272 + 13.229350*d); const l = L + RAD*6.289*Math.sin(Mn), b = RAD*5.128*Math.sin(F), dt = 385001 - 20905*Math.cos(Mn); return { ra:rightAsc(l, b), dec:declin(l, b), dist:dt }; }
function moonAlt(date, lat, lng){ const lw = RAD*-lng, phi = RAD*lat, d = toDays(date), c = moonCoords(d), H2 = sidereal(d, lw) - c.ra; let h = altit(H2, phi, c.dec); h += 0.017*RAD/Math.tan(h + 10.26*RAD/(h + 5.10*RAD)); return h/RAD; }
function moonIllum(date){ const d = toDays(date), s = (() => { const Mn = solarMA(d), L = eclLong(Mn); return { ra:rightAsc(L, 0), dec:declin(L, 0) }; })(), m = moonCoords(d), sd = 149598000;
  const phi = Math.acos(Math.sin(s.dec)*Math.sin(m.dec) + Math.cos(s.dec)*Math.cos(m.dec)*Math.cos(s.ra - m.ra)), inc = Math.atan2(sd*Math.sin(phi), m.dist - sd*Math.cos(phi)); return (1 + Math.cos(inc))/2; }
function moonDay(t0, lat, lng){
  /* rise, set and transit by scanning the local day in 5-minute steps */
  let rise = null, set = null, best = { alt:-99, t:null }, prev = moonAlt(new Date(t0), lat, lng) - 0.133;
  for (let k = 1; k <= 288; k++){
    const t = t0 + k*300e3, a = moonAlt(new Date(t), lat, lng) - 0.133;
    if (prev < 0 && a >= 0 && rise == null) rise = t - 300e3*a/(a - prev);
    if (prev >= 0 && a < 0 && set == null) set = t - 300e3*a/(a - prev);
    if (a + 0.133 > best.alt) best = { alt:a + 0.133, t };
    prev = a;
  }
  return { rise, set, transit: best.alt > 0 ? best.t : null, transitAlt: best.alt, illum: moonIllum(new Date(t0 + 12*H)) };
}

/* ---------- data ---------- */
const MODELS = DEMO ? [] : ["gfs_seamless","ecmwf_ifs025","ncep_hrrr_conus","ncep_nbm_conus"];
const PLV = [1000, 975, 950, 925, 900, 850];
async function fetchWx(){
  const p = PR();
  if (DEMO) return demoWx();
  const vars = ["temperature_2m","dew_point_2m","pressure_msl","wind_speed_10m","wind_direction_10m","wind_gusts_10m","wind_speed_80m","wind_direction_80m","freezing_level_height", ...PLV.flatMap(l => [`temperature_${l}hPa`,`wind_speed_${l}hPa`,`wind_direction_${l}hPa`,`geopotential_height_${l}hPa`])].join(",");
  const js = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&hourly=${vars}&models=${MODELS.join(",")}&temperature_unit=celsius&wind_speed_unit=kn&timezone=GMT&timeformat=unixtime&forecast_days=3&past_days=1`, 40000);
  const hr = js.hourly || {}, times = (hr.time || []).map(x => x*1000);
  /* mean across the models that have each field (vector mean for directions) */
  const mean = name => times.map((_, i) => { const v = MODELS.map(m => (hr[`${name}_${m}`] || [])[i]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0)/v.length : null; });
  const vec = (sp, dr) => times.map((_, i) => { let u = 0, v = 0, n = 0; for (const m of MODELS){ const s = (hr[`${sp}_${m}`] || [])[i], d = (hr[`${dr}_${m}`] || [])[i]; if (s == null || d == null) continue; u += -s*Math.sin(d*RAD); v += -s*Math.cos(d*RAD); n++; } return n ? { s:Math.hypot(u/n, v/n), d:(Math.atan2(-u/n, -v/n)/RAD + 360) % 360 } : null; });
  const out = { times, t:mean("temperature_2m"), td:mean("dew_point_2m"), slp:mean("pressure_msl"), fz:mean("freezing_level_height"), w10:vec("wind_speed_10m","wind_direction_10m"), w80:vec("wind_speed_80m","wind_direction_80m"), lev:{} };
  for (const l of PLV) out.lev[l] = { t:mean(`temperature_${l}hPa`), z:mean(`geopotential_height_${l}hPa`), w:vec(`wind_speed_${l}hPa`, `wind_direction_${l}hPa`) };
  return out;
}
async function fetchDZ(){
  if (DEMO) return demoDZ();
  const pts = dzWithPos(); if (!pts.length) return {};
  const lat = pts.map(d => d.lat).join(","), lon = pts.map(d => d.lon).join(",");
  const js = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=weather_code,cape,precipitation_probability,wind_gusts_10m,wind_speed_10m,wind_direction_10m,temperature_2m&models=gfs_seamless,ncep_hrrr_conus&wind_speed_unit=kn&timezone=GMT&timeformat=unixtime&forecast_days=3`, 40000);
  const arr = Array.isArray(js) ? js : [js];
  return Object.fromEntries(pts.map((d, k) => [d.id, (arr[k] || {}).hourly || {}]));
}
async function fetchSea(){
  if (DEMO) return demoSea();
  const kat = dzWithPos().find(d => d.id === "kathy"), pts = kat ? [BUOY, kat] : [BUOY];
  const js = await getJSON(`https://marine-api.open-meteo.com/v1/marine?latitude=${pts.map(p => p.lat).join(",")}&longitude=${pts.map(p => p.lon).join(",")}&hourly=wave_height,wave_period,wave_direction,sea_surface_temperature&timezone=GMT&timeformat=unixtime&forecast_days=3`, 30000);
  const arr = Array.isArray(js) ? js : [js];
  return { buoy:(arr[0] || {}).hourly || {}, kathy:(arr[1] || {}).hourly || {} };
}
async function fetchTAFs(ids){
  if (DEMO) return Object.fromEntries(ids.map(i => [i, demoTAF(i)]));
  const txt = await fetch(`https://aviationweather.gov/api/data/taf?ids=${ids.join(",")}&format=raw`).then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); });
  const out = {}; const parts = txt.replace(/\r/g, "").split(/\n(?=TAF\b)|\n\s*\n/).map(s => s.trim()).filter(Boolean);
  for (const ptx of parts){ const m = ptx.match(/^(?:TAF\s+)?(?:AMD\s+|COR\s+)?([A-Z]{4})\b/); if (m) out[m[1]] = ptx.startsWith("TAF") ? ptx : "TAF " + ptx; }
  return out;
}
const DEMO_POS = (() => { const o = {}; DZS.forEach((d, k) => { const g = d.g === "920" ? 0 : 1, n = DZS.filter(q => q.g === d.g).indexOf(d); o[d.id] = { lat: 28.6 - n*0.22, lon: (g ? -80.95 : -80.85) + (n % 2)*0.18, est:true }; }); return o; })();
/* every DZ with its position when one is loaded (demo mode uses a made-up layout) */
const dzList = () => DZS.map(d => { const p = DEMO ? (M.dzPos[d.id] || DEMO_POS[d.id]) : M.dzPos[d.id]; return p && isFinite(p.lat) && isFinite(p.lon) ? { ...d, lat:+p.lat, lon:+p.lon, est:!!p.est, has:true } : { ...d, has:false }; });
const dzWithPos = () => dzList().filter(d => d.has);
function stationTAF(){
  /* the TAF generator's draft for the station when it covers this block, else the latest issued TAF */
  const draft = store.get(`taffx:v1:draft:${PR().stn}`, null), br = blockRange();
  const ref = new Date(br.a), y = ref.getUTCFullYear(), mo = ref.getUTCMonth() + 1;
  const dT = draft && draft.text ? parseTAF(draft.text, y, mo) : null, iT = G.alts[PR().stn] ? parseTAF(G.alts[PR().stn], y, mo) : null;
  const covers = t => t && t.from <= br.a && t.to >= br.b - H;
  let use = null;
  if (M.tafSrc === "draft") use = dT ? ["draft", draft.text, dT] : null;
  else if (M.tafSrc === "issued") use = iT ? ["issued", G.alts[PR().stn], iT] : null;
  else use = covers(dT) ? ["draft", draft.text, dT] : iT ? ["issued", G.alts[PR().stn], iT] : dT ? ["draft", draft.text, dT] : null;
  if (!use){ G.taf = null; G.tafText = ""; G.tafFrom = ""; return; }
  [G.tafFrom, G.tafText, G.taf] = use;
}

/* ---------- product model ---------- */
const COLS = () => { const p = PR(); return [["time","TIME"],["sky","SKY CON"],["wind","WIND (KT)"],["vism","VIS (M)"],["vissm","VIS (SM)"],["wx","WX"],["temp","TEMP"],["dpt","DPT"], ...(p.rh ? [["rh","RH"]] : []), ["alstg","ALSTG"],["pa","PA"], ...p.rwys.map(r => ["x" + r[0], "XWND " + r[0]])]; };
const ovKey = (t, c) => `${M.prod}|${t}|${c}`;
function wxAt(field, t){ const W = G.wx; if (!W) return null; const i = W.times.findIndex(x => x === t); if (i < 0) return null; return W[field][i]; }
function model(){
  const p = PR(), br = blockRange(), rows = [];
  for (let t = br.a; t < br.b; t += H){
    const st = stateAt(G.taf, t), T = wxAt("t", t), Td = wxAt("td", t), slp = wxAt("slp", t);
    const alstg = slp != null ? slp*0.0295300 + p.elev*0.00106 : st && st.qnh != null ? st.qnh : null;
    const pa = alstg != null ? Math.round(((29.92 - alstg)*1000 + p.elev)/10)*10 : null;
    const auto = {
      time:`${p2(lH(t))}-${p2(lH(t + H)) === "00" ? "24" : p2(lH(t + H))}L/${zH(t)}-${zH(t + H)}Z`,
      sky: st ? skyText(st) : "", wind: st ? windText(st.wind) : "", vism: st && st.vis != null ? String(Math.min(9999, st.vis)).padStart(4, "0") : "", vissm: st ? visSM(st.vis) : "",
      wx: st ? wxText(st) : "", temp: T != null ? `${Math.round(T)}C` : "", dpt: Td != null ? `${Math.round(Td)}C` : "", rh: T != null && Td != null ? `${Math.round(rhFrom(T*9/5 + 32, Td*9/5 + 32))}%` : "",
      alstg: alstg != null ? alstg.toFixed(2) : "", pa: pa != null ? String(pa) : "",
    };
    p.rwys.forEach(([nm, hdg]) => { const x = st ? xwind(st.wind, hdg) : null; auto["x" + nm] = x == null ? "N/A" : `${p2(x)}KT`; });
    const row = { t, st, cat: category(st), tempo: st ? st.tempo : [], v:{}, auto };
    for (const [c] of COLS()){ const o = M.ov[ovKey(t, c)]; row.v[c] = o !== undefined ? o : auto[c]; row.edited = row.edited || o !== undefined; }
    rows.push(row);
  }
  return { p, br, rows };
}
/* winds and temperatures at the flight levels (hundreds of feet above ground) */
const FLS = [1, 3, 5, 10, 15, 20, 25, 30, 40];
function flTable(t){
  const W = G.wx; if (!W) return null; const i = W.times.findIndex(x => x === t); if (i < 0) return null;
  const pts = [];
  const T2 = W.t[i]; if (W.w10[i]) pts.push({ z:10, s:W.w10[i].s, d:W.w10[i].d, T:T2 }); if (W.w80[i]) pts.push({ z:80, s:W.w80[i].s, d:W.w80[i].d, T:null });
  for (const l of PLV){ const L = W.lev[l], z = L.z[i], w = L.w[i]; if (z == null || !w) continue; pts.push({ z, s:w.s, d:w.d, T:L.t[i] }); }
  pts.sort((a, b) => a.z - b.z);
  const at = (zm, key) => { const q = pts.filter(x => key === "T" ? x.T != null : true); if (!q.length) return null; if (zm <= q[0].z) return q[0]; for (let k = 1; k < q.length; k++) if (zm <= q[k].z){ const a = q[k - 1], b = q[k], f = (zm - a.z)/(b.z - a.z); if (key === "T") return { T:a.T + f*(b.T - a.T) }; const u = -(a.s*(1 - f))*Math.sin(a.d*RAD) - b.s*f*Math.sin(b.d*RAD), v = -(a.s*(1 - f))*Math.cos(a.d*RAD) - b.s*f*Math.cos(b.d*RAD); return { s:Math.hypot(u, v), d:(Math.atan2(-u, -v)/RAD + 360) % 360 }; } return q[q.length - 1]; };
  const rows = FLS.map(fl => { const zm = fl*100*0.3048, w = at(zm, "w"), tt = at(zm, "T"); return { fl, wind: w ? `${String(Math.round(w.d/10)*10 || 360).padStart(3, "0")}${p2(Math.round(w.s))}KT` : "", temp: tt && tt.T != null ? `${Math.round(tt.T)}C` : "" }; });
  const fz = W.fz[i]; return { rows, fz: fz != null ? String(Math.round(fz*3.28084/100)) : "" };
}
function astro(){
  const p = PR(), [y, mo, d] = (M.date || todayLocal()).split("-").map(Number), mid = localToUTC(y, mo, d, 12, 0), t0 = localToUTC(y, mo, d, 0, 0);
  const s = sunTimes(new Date(mid), p.lat, p.lon), m = moonDay(t0, p.lat, p.lon), f = t => t == null || !isFinite(t) ? "N/A" : lHM(t);
  return { sunrise:f(s.sunrise), sunset:f(s.sunset), civB:f(s.civilBegin), civE:f(s.civilEnd), nautB:f(s.nautBegin), nautE:f(s.nautEnd), moonrise:f(m.rise), moonset:f(m.set), transit:f(m.transit), transitAlt:m.transit ? `${m.transitAlt.toFixed(1)}°` : "N/A", illum:`${(m.illum*100).toFixed(1)}%` };
}
/* solar/lunar block: PSFB carries civil twilight, NASA the moon's altitude and meridian passing */
function solarRows(p, a, sea, Tnow){
  const ss = seaSummary("buoy");
  const seaRow = [["SEA TEMP (F):", ss.sst != null ? ss.sst + "F" : ""], ["AIR TEMP (F):", Tnow != null ? Math.round(Tnow*9/5 + 32) + "F" : ""], ["WAVE HEIGHT:", ss.wave]];
  return p.civil
    ? [[["SUNRISE:", a.sunrise], ["BEGIN NAUT TL:", a.nautB], ["BEGIN CIV TL:", a.civB]], [["SUNSET:", a.sunset], ["MOONRISE:", a.moonrise], ["END CIV TL:", a.civE]], [["END NAUT TL:", a.nautE], ["MOONSET:", a.moonset], ["MOON ILLUM (%):", a.illum]], seaRow]
    : [[["SUNRISE:", a.sunrise], ["BEGIN NAUT TL:", a.nautB], ["MOONRISE:", a.moonrise]], [["SUNSET:", a.sunset], ["END NAUT TL:", a.nautE], ["MOONSET:", a.moonset]], [["MOON ALTITUDE:", a.transitAlt], ["MERIDIAN PASSING:", a.transit], ["MOON ILLUM (%):", a.illum]], seaRow];
}
function seaAt(src, t){
  const S = G.sea && G.sea[src]; if (!S || !S.time) return null; const i = S.time.findIndex(x => x*1000 >= t); if (i < 0) return null;
  const g = k => S[k] ? S[k][i] : null, wh = g("wave_height"), sst = g("sea_surface_temperature");
  return { wave: wh != null ? wh*3.28084 : null, per: g("wave_period"), dir: g("wave_direction"), sst: sst != null ? sst*9/5 + 32 : null };
}
const waveText = ft => ft == null ? "" : (() => { const lo = Math.max(0, Math.floor(ft)), hi = Math.ceil(ft + 0.5); return lo === hi || hi - lo < 1 ? `${lo} FT` : `${lo}-${hi} FT`; })();
/* first-guess DZ hazard for the block from the models (the forecaster sets the final one) */
function dzAuto(id){
  if (!dzWithPos().some(d => d.id === id)) return { id:"none", why:"no position loaded" };
  const h = G.dz && G.dz[id]; if (!h || !h.time) return { id:"none", why:"no guidance" };
  const br = blockRange(); let ts = 0, conv = 0, gust = 0;
  h.time.forEach((tt, i) => { const t = tt*1000; if (t < br.a || t >= br.b) return;
    for (const mdl of ["gfs_seamless","ncep_hrrr_conus", ""]){ const sfx = mdl ? "_" + mdl : ""; const wc = (h["weather_code" + sfx] || [])[i], cape = (h["cape" + sfx] || [])[i], pp = (h["precipitation_probability" + sfx] || [])[i], g = (h["wind_gusts_10m" + sfx] || [])[i];
      if (wc != null && wc >= 95) ts++; if ((cape != null && cape >= 1000 && (pp == null || pp >= 30)) || (wc != null && wc >= 80 && cape >= 500)) conv++; if (g != null) gust = Math.max(gust, g); } });
  if (ts) return { id:"ts", why:"thunder in the guidance during the block" };
  if (gust >= 45) return { id:"sev", why:`gusts to ${Math.round(gust)} kt` };
  if (conv) return { id:"vcts", why:"unstable with showers nearby" };
  if (gust >= 30) return { id:"turb", why:`gusts to ${Math.round(gust)} kt` };
  return { id:"none", why:"quiet guidance" };
}
const dzState = id => { const s = M.dz[id]; const a = dzAuto(id); return s && s !== "auto" ? { id:s, auto:false, why:a.why } : { ...a, auto:true }; };

/* coordinates: decimal degrees, or degrees and decimal minutes ("28 15.500 N", "080 40.250 W") */
function parseCoord(t){
  t = String(t || "").trim().toUpperCase(); if (!t) return null;
  const neg = /[SW]$/.test(t) || t.startsWith("-"); const nums = t.replace(/[^0-9.\s]/g, " ").trim().split(/\s+/).map(Number).filter(isFinite);
  if (!nums.length) return null;
  const v = nums[0] + (nums[1] || 0)/60 + (nums[2] || 0)/3600;
  return neg ? -v : v;
}
/* a positions file: JSON from "Save positions file", or CSV with name or id, lat, lon */
function importDZ(text){
  let rows = [];
  try { const js = JSON.parse(text); if (js && js.positions) rows = Object.entries(js.positions).map(([id, p]) => ({ id, name:p.name, lat:p.lat, lon:p.lon })); else throw new Error("not a positions file"); }
  catch (e){
    const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim()); const head = lines[0].toLowerCase().split(",").map(x => x.trim());
    const ix = k => head.findIndex(h => h === k || h.startsWith(k));
    if (ix("lat") < 0 || ix("lon") < 0) throw new Error("needs lat and lon columns");
    rows = lines.slice(1).map(l => { const c = l.split(","); return { id:(c[ix("id")] || "").trim(), name:(c[ix("name")] || c[0] || "").trim(), lat:c[ix("lat")], lon:c[ix("lon")] }; });
  }
  const norm = v => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  let n = 0;
  for (const r of rows){
    const d = DZS.find(q => q.id === r.id || norm(q.name) === norm(r.name) || norm(q.name).startsWith(norm(r.name)) && norm(r.name).length > 3);
    const la = parseCoord(r.lat), lo = parseCoord(r.lon);
    if (!d || la == null || lo == null) continue;
    M.dzPos[d.id] = { lat:la, lon: lo > 0 ? -lo : lo, est:false }; n++;
  }
  save(); return n;
}
function toast(msg){ const t = $("toast"); if (!t) return; t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 3200); }
/* ---------- render ---------- */
function renderControls(){
  document.querySelectorAll("#prodSel button").forEach(b => b.setAttribute("aria-pressed", b.dataset.p === M.prod));
  document.querySelectorAll("#blkSel button").forEach(b => b.setAttribute("aria-pressed", b.dataset.b === M.block));
  const [a, b] = M.blocks[M.block]; $("blkA").value = a; $("blkB").value = b;
  $("mdate").value = M.date || todayLocal(); $("mfc").value = M.fc || ""; $("mmef").value = M.mef || "";
  $("tafSrc").value = M.tafSrc; $("tafInfo").textContent = G.tafText ? `Using the ${G.tafFrom === "draft" ? "TAF generator draft" : "latest issued TAF"} for ${PR().stn}.` : `No ${PR().stn} TAF yet: draft one on the TAF generator page, or the issued TAF will load when available.`;
  const br = blockRange(); const hrs = []; for (let t = br.a; t < br.b; t += H) hrs.push(t);
  if (M.flHour == null || !hrs.includes(M.flHour)) M.flHour = hrs[Math.min(hrs.length - 1, Math.floor(hrs.length/2))] ?? br.a;
  $("flHour").innerHTML = hrs.map(t => `<option value="${t}" ${t === M.flHour ? "selected" : ""}>${zH(t)}Z (${p2(lH(t))}L)</option>`).join("");
  ["watch","warning","advisory"].forEach(k => { if (document.activeElement !== $("w_" + k)) $("w_" + k).value = M.wwa[k] || ""; });
  $("dzPanel").hidden = !PR().dz;
}
function renderTable(){
  const m = model(), cols = COLS();
  $("tbl").innerHTML = `<table class="mt"><thead><tr><th class="cat">CAT</th>${cols.map(([, h]) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${m.rows.map(r => `<tr>
    <td class="cat"><span class="cb" style="background:${catColor(r.cat)}">${r.cat || ""}</span></td>
    ${cols.map(([c]) => { const ov = M.ov[ovKey(r.t, c)] !== undefined; const wx = c === "wx" ? wxClass(r.v.wx) : ""; return `<td class="${c === "time" ? "tm" : "ed"} ${ov ? "ov" : ""} ${wx}" ${c === "time" ? "" : `contenteditable="true" data-t="${r.t}" data-c="${c}" spellcheck="false"`}>${esc(r.v[c])}</td>`; }).join("")}
    </tr>${r.tempo.length ? `<tr class="tp"><td></td><td colspan="${cols.length}">${r.tempo.map(g => `${g.prob || "TEMPO"} ${esc(g.raw.slice(1).join(" "))}`).join(" · ")}</td></tr>` : ""}`).join("")}</tbody></table>`;
  return m;
}
const wxClass = w => /TS/.test(w || "") && !/^VCTS$/.test(w) ? "wxr" : /VCTS|SH|VCSH|BR|FG|DZ|RA/.test(w || "") ? "wxy" : "";
function renderProduct(){
  const m = model(), p = m.p, a = astro(), fl = flTable(M.flHour), sea = seaAt("buoy", M.flHour), Tnow = wxAt("t", M.flHour);
  const head = `<div class="ph"><img src="${esc(LOGO_SRC)}" alt="" onerror="this.style.visibility='hidden'"><div class="pt"><b>${p.title}</b><span class="red">NOT AN EXECUTION FORECAST UNTIL VALIDATED BY 45WS TECHNICIAN</span><span>45WS MISSION FORECASTERS: DSN 467-8485 / COMM 321-853-8485</span></div>${p.key === "psfb" ? `<img src="${esc(SEAL_SRC)}" alt="" onerror="this.style.visibility='hidden'">` : "<span></span>"}
    <table class="pm"><tr><th>DATE:</th><td>${dateLabel()}</td></tr><tr><th>VALID TIME:</th><td>${M.block} ${p2(M.blocks[M.block][0])}-${p2(M.blocks[M.block][1])}L</td></tr><tr><th>FORECASTER:</th><td>${esc(M.fc)}</td></tr><tr><th>MEF #:</th><td>${esc(M.mef)}</td></tr></table></div>`;
  const cols = COLS();
  const tl = `<div class="bar">${p.place} TAKE-OFF/LANDING DATA</div><table class="pt2"><tr>${cols.map(([, h]) => `<th>${h}</th>`).join("")}<th>CAT</th></tr>${m.rows.map(r => `<tr>${cols.map(([c]) => `<td class="${c === "wx" ? wxClass(r.v.wx) : ""}">${esc(r.v[c])}</td>`).join("")}<td><span class="cb" style="background:${catColor(r.cat)}">${r.cat || ""}</span></td></tr>`).join("")}</table>`;
  const flt = `<table class="fl"><tr><th colspan="3" class="dk">FLT LEVEL WINDS / TEMP <span>${zH(M.flHour)}Z</span></th></tr><tr><th>FL (AGL)</th><th>WIND</th><th>TEMP</th></tr>${(fl ? fl.rows : []).map(r => `<tr><td>${String(r.fl).padStart(3, "0")}</td><td>${r.wind}</td><td>${r.temp}</td></tr>`).join("")}<tr><th>FREEZING LEVEL</th><td colspan="2">${fl ? fl.fz : ""}</td></tr></table>`;
  const ssb = seaSummary("buoy");
  const sol = `<table class="sl"><tr><th colspan="6" class="dk">SOLAR/LUNAR ILLUMINATION (LOCAL) / SEA STATE (${BUOY.name.toUpperCase()})</th></tr>${solarRows(p, a, sea, Tnow).map(r => `<tr>${r.map(([k, v]) => `<th>${k}</th><td>${v}</td>`).join("")}</tr>`).join("")}
    <tr><th>NWS SEAS:</th><td colspan="5" class="lft">${esc(nwsText(ssb.nws) || "NWS coastal waters forecast not available; wave height from the model")}</td></tr>
    <tr><th>41009 OBS:</th><td colspan="5" class="lft">${esc(obsText(ssb.obs) || "no recent buoy observation")}</td></tr></table>`;
  const wwa = `<table class="ww"><tr><th colspan="2" class="dk">ACTIVE WATCHES, WARNINGS, AND ADVISORIES</th></tr>${["watch","warning","advisory"].map(k => `<tr><th>${k.toUpperCase()}</th><td>${esc(M.wwa[k] || "")}</td></tr>`).join("")}</table>`;
  const alts = `<div class="bar">PLANNING / ALTERNATE &amp; DIVERT FORECASTS</div><div class="alts">${p.alts.map(id => altBox(id)).join("")}</div>`;
  let html = `<div class="prod">${head}${tl}<div class="mid"><div>${flt}</div><div>${sol}${wwa}</div></div>${alts}</div>`;
  if (p.dz) html += `<div class="prod p2">${dzPage()}</div>`;
  $("preview").innerHTML = html;
}
function altBox(id){
  const txt = M.altPaste[id] || G.alts[id] || "", br = blockRange(), ref = new Date(br.a), T = parseTAF(txt, ref.getUTCFullYear(), ref.getUTCMonth() + 1);
  const lines = txt.replace(/\s+(FM\d{6}|BECMG|TEMPO|PROB\d{2})/g, "\n$1").split("\n").map(s => s.trim()).filter(Boolean);
  const gcat = l => { const g = parseTAF((l.startsWith("TAF") ? l : `TAF ${id} 010000Z 0100/0200 ${l}`), ref.getUTCFullYear(), ref.getUTCMonth() + 1); return g ? category(stateAt(g, g.from)) : null; };
  const strip = T ? (() => { const cells = []; for (let t = br.a; t < br.b; t += H){ const st = stateAt(T, t); const c = t >= T.from && t < T.to ? category(st) : null; cells.push(`<i title="${zH(t)}Z ${c || "outside the TAF"}" style="background:${c ? catColor(c) : "transparent"}"></i>`); } return `<div class="cstrip">${cells.join("")}<span>${zH(br.a)}Z–${zH(br.b)}Z</span></div>`; })() : "";
  return `<div class="alt"><div class="ah">${id}</div>${strip}<pre>${lines.map(l => { const c = l.startsWith("TEMPO") || l.startsWith("PROB") ? gcat(l.replace(/^(TEMPO|PROB\d{2}( TEMPO)?)\s+\d{4}\/\d{4}\s*/, "")) : gcat(l.replace(/^TAF\s+(AMD\s+|COR\s+)?[A-Z]{4}\s+\d{6}Z\s+\d{4}\/\d{4}\s*/, "").replace(/^FM\d{6}\s*/, "").replace(/^BECMG\s+\d{4}\/\d{4}\s*/, "")); return `<span class="cb sm" style="background:${catColor(c)}">${c || "–"}</span> ${esc(l)}`; }).join("\n") || "<span class=\"mut\">No TAF</span>"}</pre></div>`;
}
/* the DZ hazard page (PSFB): two maps, the legend and the discussion */
const MAPB = { la0:27.30, la1:28.95, lo0:-81.55, lo1:-80.05 };
/* each map frames its own DZs, and labels move to the left or down when they would overlap */
function dzLayout(group, W, Hh, cw){
  const dz = dzWithPos().filter(d => d.g === group);
  if (!dz.length){ const x = v => (v - MAPB.lo0)/(MAPB.lo1 - MAPB.lo0)*W, y = v => (MAPB.la1 - v)/(MAPB.la1 - MAPB.la0)*Hh; return { x, y, pts:[] }; }
  const la = dz.map(d => d.lat), lo = dz.map(d => d.lon);
  let la0 = Math.min(...la) - 0.22, la1 = Math.max(...la) + 0.22, lo0 = Math.min(...lo) - 0.35, lo1 = Math.max(...lo) + 0.35;
  /* keep the map's shape (a degree of longitude is about 0.88 of a degree of latitude here) */
  const want = (W/Hh)*(la1 - la0)/0.88, have = lo1 - lo0;
  if (want > have){ const d = (want - have)/2; lo0 -= d; lo1 += d; } else { const need = have*0.88*(Hh/W), d = (need - (la1 - la0))/2; la0 -= d; la1 += d; }
  const x = v => (v - lo0)/(lo1 - lo0)*W, y = v => (la1 - v)/(la1 - la0)*Hh;
  const boxes = [], pts = dz.map(d => ({ d, X:x(d.lon), Y:y(d.lat) }));
  for (const q of pts) boxes.push({ x:q.X - 7, y:q.Y - 7, w:14, h:14 });
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const q of pts){
    const lab = q.d.name.toUpperCase() + (q.d.est ? "*" : ""), w = cw(lab) + 8, h = 15;
    const tries = [[10, -8], [-10 - w, -8], [10, 6], [-10 - w, 6], [10, -22], [-10 - w, -22], [10, 20], [-10 - w, 20], [-w/2, 10], [-w/2, -26], [10, 34], [-10 - w, 34], [10, -36], [-10 - w, -36]];
    /* the first spot that overlaps nothing, otherwise the one that overlaps least */
    const over = b => boxes.reduce((s2, o) => s2 + (hit(o, b) ? (Math.min(o.x + o.w, b.x + b.w) - Math.max(o.x, b.x))*(Math.min(o.y + o.h, b.y + b.h) - Math.max(o.y, b.y)) : 0), 0);
    let best = null, bestS = Infinity;
    for (const [dx, dy] of tries){ const bx = { x:Math.max(2, Math.min(W - w - 2, q.X + dx)), y:Math.max(2, Math.min(Hh - h - 2, q.Y + dy)), w, h }; const sc = over(bx); if (sc === 0){ best = bx; break; } if (sc < bestS){ bestS = sc; best = bx; } }
    boxes.push(best); q.lab = lab; q.box = best;
  }
  return { x, y, pts };
}
const COAST = [[28.95,-80.86],[28.80,-80.74],[28.70,-80.64],[28.58,-80.58],[28.45,-80.53],[28.40,-80.60],[28.32,-80.61],[28.20,-80.595],[28.05,-80.56],[27.95,-80.52],[27.85,-80.46],[27.70,-80.39],[27.55,-80.33],[27.40,-80.27],[27.30,-80.24]];
function dzMap(group, W, Hh){
  const L = dzLayout(group, W, Hh, t => t.length*6.6);
  const ext = [[29.4, COAST[0][1] - 0.1], ...COAST, [26.9, COAST[COAST.length - 1][1] + 0.05]];
  const sea = `M${L.x(ext[0][1]).toFixed(1)},${L.y(ext[0][0]).toFixed(1)} ` + ext.map(c => `L${L.x(c[1]).toFixed(1)},${L.y(c[0]).toFixed(1)}`).join(" ") + ` L${W + 400},${L.y(ext[ext.length - 1][0]).toFixed(1)} L${W + 400},${L.y(ext[0][0]).toFixed(1)} Z`;
  return `<svg viewBox="0 0 ${W} ${Hh}" class="dzmap" role="img" aria-label="${group === "920" ? "920th" : "DOS"} drop zones"><rect width="${W}" height="${Hh}" fill="#C9D8B6"/><path d="${sea}" fill="#2B4F7E"/>
    ${L.pts.map(q => { const s = dzState(q.d.id), c = HCOL[(HAZ.find(h => h.id === s.id) || HAZ[0]).c]; return `<g><circle cx="${q.X.toFixed(1)}" cy="${q.Y.toFixed(1)}" r="7" fill="${c}" stroke="#fff" stroke-width="1.5"/><rect x="${q.box.x.toFixed(1)}" y="${q.box.y.toFixed(1)}" width="${q.box.w.toFixed(1)}" height="${q.box.h}" rx="3" fill="rgba(255,255,255,.88)"/><text x="${(q.box.x + 4).toFixed(1)}" y="${(q.box.y + 11).toFixed(1)}" font-size="11" font-weight="700" fill="#13202E">${esc(q.lab)}</text></g>`; }).join("")}</svg>`;
}
function dzPage(){
  const br = blockRange(), valid = `${p2(lH(br.a))}L-${p2(lH(br.b)) === "00" ? "24" : p2(lH(br.b))}L/${zH(br.a)}Z-${zH(br.b)}Z`, kathy = seaAt("kathy", M.flHour);
  return `<div class="dzh"><div><div class="dzt"><b>920TH HZRDS VALID:</b><span>${valid}</span></div>${dzMap("920", 300, 380)}</div><div><div class="dzt"><b>DOS HZRDS VALID:</b><span>${valid}</span></div>${dzMap("dos", 300, 380)}</div></div>
    <div class="dzl"><div class="leg"><div class="lh">DZ HAZARD LEGEND: CONTACT WX FOR SPECIFIC DZ TIMING/HAZARDS. SEVERE TURBULENCE/ICING IS ASSUMED WITH THUNDERSTORMS.</div>${HAZ.slice(1).map(h => `<div class="li ${h.c}">${h.t.toUpperCase()}</div>`).join("")}</div>
    <div class="disc"><div class="lh2">HAZARD DISCUSSION</div><div class="warnb">DUE TO LOCAL EFFECTS, HAZARDS ARE SUBJECT TO RAPID CHANGE. CALL 24/7 OPS CENTER AT 321-853-8485 FOR VALIDATION.</div><p>${esc(M.dzDisc || "")}</p>
    ${kathyHTML()}</div></div>
    ${DEMO ? '<p class="mut est">Demo mode: drop zone positions are made up.</p>' : dzWithPos().length < DZS.length ? `<p class="mut est">${DZS.length - dzWithPos().length} drop zone(s) not shown: position not loaded.</p>` : ""}`;
}
function kathyLines(){
  if (!dzWithPos().some(d => d.id === "kathy")) return ["KATHY (WATER DZ): position not loaded on this computer"];
  const k = seaSummary("kathy"), m = k.model, out = [];
  out.push(`KATHY (WATER DZ): seas ${k.wave || "–"}${k.waveSrc ? ` (${k.waveSrc})` : ""}; sea temp ${k.sst != null ? k.sst + "F" : "–"}${k.sstSrc ? ` (${k.sstSrc})` : ""}`);
  if (k.nws) out.push(nwsText(k.nws));
  if (m) out.push(`Model at the DZ: waves ${waveText(m.wave)}${m.per ? `, ${Math.round(m.per)} s` : ""}${m.dir != null ? ` from ${Math.round(m.dir/10)*10}°` : ""}`);
  if (k.obs) out.push(`Nearshore buoy ${obsText(k.obs)}`);
  return out;
}
const kathyHTML = () => { const L2 = kathyLines(); return `<p class="kat"><b>${esc(L2[0].split(":")[0])}:</b>${esc(L2[0].slice(L2[0].indexOf(":") + 1))}${L2.slice(1).map(l => `<br>${esc(l)}`).join("")}</p>`; };
function renderDZ(){
  if (!PR().dz) return;
  const n = dzWithPos().length; $("dzPosState").textContent = DEMO ? "Demo mode: made-up positions." : n ? `${n} of ${DZS.length} positions loaded on this computer.` : "No positions loaded yet: open the positions file, or type them in.";
  $("dzRows").innerHTML = dzList().map(d => { const s = dzState(d.id); return `<tr><td>${d.g === "920" ? "920th" : "DOS"}</td><td><b>${esc(d.name)}</b>${d.has && d.est ? ' <span class="mut">(estimated)</span>' : ""}</td><td><input data-dzp="${d.id}" data-k="lat" value="${d.has ? d.lat : ""}" placeholder="lat" inputmode="decimal"> <input data-dzp="${d.id}" data-k="lon" value="${d.has ? d.lon : ""}" placeholder="lon" inputmode="decimal"></td>
    <td><select data-dz="${d.id}"><option value="auto" ${s.auto ? "selected" : ""}>Auto: ${esc((HAZ.find(h => h.id === dzAuto(d.id).id) || HAZ[0]).t)}</option>${HAZ.map(h => `<option value="${h.id}" ${!s.auto && s.id === h.id ? "selected" : ""}>${esc(h.t)}</option>`).join("")}</select></td><td class="mut">${esc(s.why || "")}</td></tr>`; }).join("");
  if (document.activeElement !== $("dzDisc")) $("dzDisc").value = M.dzDisc || "";
}
function renderAll(){ stationTAF(); renderControls(); renderTable(); renderDZ(); renderProduct(); renderStatus(); }
function renderStatus(){ $("live").textContent = Object.entries(G.status).map(([k, v]) => `${k}: ${v}`).join(" · ") || "Loading"; }

/* ---------- PDF (US Letter portrait; page 2 for the PSFB DZ hazards) ---------- */
async function loadImg(src){ try { const r = await fetch(src); if (!r.ok) return null; return await decodeImage(new Uint8Array(await r.arrayBuffer()), "image/png"); } catch (e) { return null; } }
async function pdfMWP(){
  const m = model(), p = m.p, a = astro(), fl = flTable(M.flHour), sea = seaAt("buoy", M.flHour), Tnow = wxAt("t", M.flHour);
  const logo = await loadImg(LOGO_SRC), seal = p.key === "psfb" ? await loadImg(SEAL_SRC) : null;
  const W = 612, Hp = 792, X0 = 24, X1 = 588, pages = []; let cs = [];
  const f = n => (+n).toFixed(2), rgbf = c => c.map(v => f(v/255)).join(" ");
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const rect = (x, y, w, h, c) => cs.push(`${rgbf(c)} rg ${f(x)} ${f(Hp - y - h)} ${f(w)} ${f(h)} re f`);
  const box = (x, y, w, h, lw) => cs.push(`0 0 0 RG ${f(lw || .6)} w ${f(x)} ${f(Hp - y - h)} ${f(w)} ${f(h)} re S`);
  const fit = (s, mw, size, b) => { let z = size; while (z > 4.5 && textW(s, z, b) > mw) z -= .25; return z; };
  const text = (s, x, y, size, o = {}) => { s = String(s ?? ""); const z = o.max ? fit(s, o.max, size, o.bold) : size, w = textW(s, z, o.bold); const tx = o.align === "c" ? x - w/2 : o.align === "r" ? x - w : x; cs.push(`BT ${rgbf(o.color || [0,0,0])} rg /${o.bold ? "F2" : "F1"} ${f(z)} Tf ${f(tx)} ${f(Hp - y)} Td ${pdfStr(s)} Tj ET`); };
  const NAVY = [16,40,72], DARK = [26,26,26], GREY = [210,214,218];
  /* header */
  rect(X0, 24, X1 - X0, 58, NAVY);
  if (logo){ const lh = 50, lw = lh*logo.rw/logo.rh; cs.push(`q ${f(lw)} 0 0 ${f(lh)} ${f(X0 + 6)} ${f(Hp - 28 - lh)} cm /Im1 Do Q`); }
  if (seal){ const lh = 50, lw = lh*seal.rw/seal.rh; cs.push(`q ${f(lw)} 0 0 ${f(lh)} ${f(X1 - 150 - lw)} ${f(Hp - 28 - lh)} cm /Im2 Do Q`); }
  const cx = (X0 + 66 + X1 - 150 - (seal ? 56 : 0))/2;
  text(p.title, cx, 44, 10.5, { bold:true, color:[255,255,255], align:"c", max:330 });
  text("NOT AN EXECUTION FORECAST UNTIL VALIDATED BY 45WS TECHNICIAN", cx, 58, 7.5, { bold:true, color:[235,70,60], align:"c", max:330 });
  text("45WS MISSION FORECASTERS: DSN 467-8485 / COMM 321-853-8485", cx, 72, 8, { color:[255,255,255], align:"c", max:330 });
  const mx = X1 - 146; [["DATE:", dateLabel()], ["VALID TIME:", `${M.block} ${p2(M.blocks[M.block][0])}-${p2(M.blocks[M.block][1])}L`], ["FORECASTER:", M.fc], ["MEF #:", M.mef]].forEach(([k, v], i) => { rect(mx, 24 + i*14.5, 146, 14.5, i % 2 ? [255,255,255] : [255,255,255]); box(mx, 24 + i*14.5, 146, 14.5, .5); text(k, mx + 4, 34 + i*14.5, 7, { bold:true }); text(v || "", mx + 142, 34 + i*14.5, 8, { bold:true, align:"r", max:70 }); });
  let y = 84;
  const bar = (t, yy) => { rect(X0, yy, X1 - X0, 15, DARK); text(t, (X0 + X1)/2, yy + 11, 10, { bold:true, color:[255,255,255], align:"c" }); return yy + 15; };
  y = bar(`${p.place} TAKE-OFF/LANDING DATA`, y);
  /* take-off/landing table */
  const cols = [...COLS(), ["cat","CAT"]], wts = { time:2.1, sky:2.0, wind:1.4, vism:1, vissm:1, wx:1.8, temp:.8, dpt:.8, rh:.8, alstg:1.1, pa:.8, cat:1 }, tot = cols.reduce((s, [c]) => s + (wts[c] || 1.3), 0), cw = cols.map(([c]) => (X1 - X0)*(wts[c] || 1.3)/tot);
  let x = X0; cols.forEach(([, h], i) => { rect(x, y, cw[i], 16, [255,255,255]); box(x, y, cw[i], 16, .5); text(h, x + cw[i]/2, y + 11, 7.5, { bold:true, align:"c", max:cw[i] - 3 }); x += cw[i]; }); y += 16;
  for (const r of m.rows){
    x = X0;
    cols.forEach(([c], i) => {
      const v = c === "cat" ? (r.cat || "") : r.v[c];
      const fillc = c === "cat" ? hex(catColor(r.cat)) : c === "wx" && wxClass(v) === "wxr" ? [252,215,213] : c === "wx" && wxClass(v) === "wxy" ? [253,236,186] : [255,255,255];
      rect(x, y, cw[i], 15, fillc); box(x, y, cw[i], 15, .4);
      text(v, x + cw[i]/2, y + 10.5, c === "time" ? 6.5 : 7.5, { bold:true, align:"c", max:cw[i] - 3, color: c === "cat" ? [255,255,255] : c === "wx" && wxClass(v) === "wxr" ? [180,30,30] : [0,0,0] });
      x += cw[i];
    });
    y += 15;
  }
  /* flight-level winds (left) and solar/lunar, sea state, watches (right) */
  y += 4; const yTop = y, lw2 = 196;
  rect(X0, y, lw2, 15, DARK); text("FLT LEVEL WINDS / TEMP", X0 + 6, y + 11, 8.5, { bold:true, color:[255,255,255] }); text(`${zH(M.flHour)}Z`, X0 + lw2 - 6, y + 11, 9, { bold:true, color:[255,255,255], align:"r" }); y += 15;
  [["FL (AGL)", 52], ["WIND", 96], ["TEMP", 48]].reduce((xx, [h, w]) => { rect(xx, y, w, 13, GREY); box(xx, y, w, 13, .4); text(h, xx + w/2, y + 9.5, 7, { bold:true, align:"c" }); return xx + w; }, X0); y += 13;
  for (const r of (fl ? fl.rows : [])){ [[String(r.fl).padStart(3, "0"), 52], [r.wind, 96], [r.temp, 48]].reduce((xx, [v, w], k) => { rect(xx, y, w, 13, k === 1 ? [255,255,255] : [255,255,255]); box(xx, y, w, 13, .4); text(v, xx + w/2, y + 9.5, 8, { bold:true, align:"c" }); return xx + w; }, X0); y += 13; }
  rect(X0, y, 104, 13, GREY); box(X0, y, 104, 13, .4); text("FREEZING LEVEL", X0 + 52, y + 9.5, 7, { bold:true, align:"c" }); box(X0 + 104, y, 92, 13, .4); text(fl ? fl.fz : "", X0 + 150, y + 9.5, 8, { bold:true, align:"c" }); y += 13;
  const yL = y;
  /* right column */
  let yr = yTop; const rx = X0 + lw2 + 4, rw = X1 - rx;
  rect(rx, yr, rw, 15, DARK); text(`SOLAR/LUNAR ILLUMINATION (LOCAL) / SEA STATE (${BUOY.name.toUpperCase()})`, rx + rw/2, yr + 11, 7.5, { bold:true, color:[255,255,255], align:"c", max:rw - 6 }); yr += 15;
  const srows = solarRows(p, a, sea, Tnow);
  const sw = [rw*0.2, rw*0.12, rw*0.2, rw*0.12, rw*0.22, rw*0.14];
  for (const row of srows){ let xx = rx; row.forEach(([k, v], i) => { box(xx, yr, sw[i*2], 14, .4); text(k, xx + sw[i*2] - 3, yr + 10, 6.5, { bold:true, align:"r", max:sw[i*2] - 4 }); xx += sw[i*2]; box(xx, yr, sw[i*2 + 1], 14, .4); text(v, xx + sw[i*2 + 1]/2, yr + 10, 7.5, { bold:true, align:"c" }); xx += sw[i*2 + 1]; }); yr += 14; }
  { const ssb = seaSummary("buoy"); [["NWS SEAS:", nwsText(ssb.nws) || "not available; wave height from the model"], ["41009 OBS:", obsText(ssb.obs) || "no recent observation"]].forEach(([k, v]) => { box(rx, yr, sw[0], 13, .4); text(k, rx + sw[0] - 3, yr + 9.5, 6.5, { bold:true, align:"r" }); box(rx + sw[0], yr, rw - sw[0], 13, .4); text(v, rx + sw[0] + 4, yr + 9.5, 6.8, { max:rw - sw[0] - 8 }); yr += 13; }); }
  rect(rx, yr, rw, 15, DARK); text("ACTIVE WATCHES, WARNINGS, AND ADVISORIES", rx + rw/2, yr + 11, 8.5, { bold:true, color:[255,255,255], align:"c" }); yr += 15;
  const wh = Math.max(20, (yL - yr)/3);
  for (const k of ["watch","warning","advisory"]){ rect(rx, yr, 80, wh, GREY); box(rx, yr, 80, wh, .4); text(k.toUpperCase(), rx + 40, yr + wh/2 + 3, 8, { bold:true, align:"c" }); box(rx + 80, yr, rw - 80, wh, .4); text(M.wwa[k] || "", rx + 84, yr + wh/2 + 3, 7.5, { max:rw - 88 }); yr += wh; }
  y = Math.max(yL, yr) + 4;
  /* alternate TAFs with categories */
  y = bar("PLANNING / ALTERNATE & DIVERT FORECASTS", y);
  const colW = (X1 - X0 - 6)/2, ids = p.alts, ref = new Date(m.br.a);
  for (let k = 0; k < ids.length; k += 2){
    let hMax = 0;
    [ids[k], ids[k + 1]].forEach((id, j) => {
      if (!id) return; const xx = X0 + j*(colW + 6); const txt = M.altPaste[id] || G.alts[id] || "";
      rect(xx, y, colW, 13, GREY); text(id, xx + colW/2, y + 9.5, 8.5, { bold:true, align:"c" });
      const lines = txt.replace(/\s+(FM\d{6}|BECMG|TEMPO|PROB\d{2})/g, "\n$1").split("\n").map(s => s.trim()).filter(Boolean);
      let yy = y + 22; const T = parseTAF(txt, ref.getUTCFullYear(), ref.getUTCMonth() + 1);
      if (T){ const n = Math.round((m.br.b - m.br.a)/H), cwid = Math.min(14, (colW - 70)/n); for (let q = 0; q < n; q++){ const t = m.br.a + q*H, c = t >= T.from && t < T.to ? category(stateAt(T, t)) : null; if (c) rect(xx + 4 + q*cwid, yy - 6, cwid - 1, 5, hex(catColor(c))); } text(`${zH(m.br.a)}Z-${zH(m.br.b)}Z category`, xx + 8 + n*cwid, yy - 1.5, 6, { color:[90,100,110] }); yy += 7; }
      for (const l of lines){
        const body = l.replace(/^TAF\s+(AMD\s+|COR\s+)?[A-Z]{4}\s+\d{6}Z\s+\d{4}\/\d{4}\s*/, "").replace(/^FM\d{6}\s*/, "").replace(/^BECMG\s+\d{4}\/\d{4}\s*/, "").replace(/^(TEMPO|PROB\d{2}( TEMPO)?)\s+\d{4}\/\d{4}\s*/, "");
        const g = parseTAF(`TAF ${id} 010000Z 0100/0200 ${body}`, ref.getUTCFullYear(), ref.getUTCMonth() + 1), c = g ? category(stateAt(g, g.from)) : null;
        if (c){ rect(xx + 2, yy - 6.5, 22, 8, hex(catColor(c))); text(c, xx + 13, yy, 5.5, { bold:true, color:[255,255,255], align:"c" }); }
        const words = l.split(" "); let ln = "", first = true;
        for (const wd of words){ const t2 = ln ? ln + " " + wd : wd; if (textW(t2, 6.8, false) > colW - 32 && ln){ text(ln, xx + 27, yy, 6.8); yy += 8.5; ln = wd; first = false; } else ln = t2; }
        if (ln){ text(ln, xx + 27, yy, 6.8); yy += 8.5; }
      }
      box(xx, y, colW, Math.max(60, yy - y + 2), .5); hMax = Math.max(hMax, Math.max(60, yy - y + 2));
    });
    y += hMax + 6;
    if (y > Hp - 80 && k + 2 < ids.length){ pages.push(cs); cs = []; y = 40; }
  }
  text(`Categories: VFR ceiling above 3,000 ft and visibility over 5 SM; MVFR 1,000-3,000 ft or 3-5 SM; IFR 500-999 ft or 1-3 SM; LIFR below 500 ft or 1 SM.`, X0, Math.min(Hp - 20, y + 6), 6.2, { color:[90,100,110] });
  pages.push(cs);
  /* page 2: DZ hazards */
  if (p.dz){
    cs = [];
    const br = m.br, valid = `${p2(lH(br.a))}L-${p2(lH(br.b)) === "00" ? "24" : p2(lH(br.b))}L/${zH(br.a)}Z-${zH(br.b)}Z`;
    const mw = (X1 - X0 - 10)/2, mh = 330, my = 52;
    ["920", "dos"].forEach((g, j) => {
      const xx = X0 + j*(mw + 10);
      box(xx, my - 16, mw*0.45, 16, .6); text(g === "920" ? "920TH HZRDS VALID:" : "DOS HZRDS VALID:", xx + 4, my - 5, 8, { bold:true }); box(xx + mw*0.45, my - 16, mw*0.55, 16, .6); text(valid, xx + mw*0.45 + mw*0.275, my - 5, 8, { bold:true, align:"c" });
      rect(xx, my, mw, mh, [201,216,182]);
      const LY = dzLayout(g, mw, mh, t => textW(t, 7, true)), X = lo => xx + LY.x(lo), Y = la => my + LY.y(la);
      const ext = [[29.4, COAST[0][1] - 0.1], ...COAST, [26.9, COAST[COAST.length - 1][1] + 0.05]];
      cs.push(`q ${f(xx)} ${f(Hp - my - mh)} ${f(mw)} ${f(mh)} re W n`);
      let path = `${f(X(ext[0][1]))} ${f(Hp - Y(ext[0][0]))} m `; ext.forEach(c => path += `${f(X(c[1]))} ${f(Hp - Y(c[0]))} l `); path += `${f(xx + mw + 400)} ${f(Hp - Y(ext[ext.length - 1][0]))} l ${f(xx + mw + 400)} ${f(Hp - Y(ext[0][0]))} l h`;
      cs.push(`${rgbf([43,79,126])} rg ${path} f Q`); box(xx, my, mw, mh, .6);
      for (const q of LY.pts){
        const d = q.d, s = dzState(d.id), col = hex(HCOL[(HAZ.find(h => h.id === s.id) || HAZ[0]).c]), px = xx + q.X, py = my + q.Y;
        const r0 = 5, k2 = .5523*r0; cs.push(`${rgbf(col)} rg 1 1 1 RG 1 w ${f(px + r0)} ${f(Hp - py)} m ${f(px + r0)} ${f(Hp - py + k2)} ${f(px + k2)} ${f(Hp - py + r0)} ${f(px)} ${f(Hp - py + r0)} c ${f(px - k2)} ${f(Hp - py + r0)} ${f(px - r0)} ${f(Hp - py + k2)} ${f(px - r0)} ${f(Hp - py)} c ${f(px - r0)} ${f(Hp - py - k2)} ${f(px - k2)} ${f(Hp - py - r0)} ${f(px)} ${f(Hp - py - r0)} c ${f(px + k2)} ${f(Hp - py - r0)} ${f(px + r0)} ${f(Hp - py - k2)} ${f(px + r0)} ${f(Hp - py)} c B`);
        rect(xx + q.box.x, my + q.box.y + 2, q.box.w, 11, [240,240,240]); text(q.lab, xx + q.box.x + 4, my + q.box.y + 10.5, 7, { bold:true });
      }
    });
    let y2 = my + mh + 6;
    const lw3 = mw; rect(X0, y2, lw3, 36, [0,0,0]); text("DZ HAZARD LEGEND: CONTACT WX FOR SPECIFIC DZ TIMING/HAZARDS.", X0 + lw3/2, y2 + 13, 7, { bold:true, color:[255,220,60], align:"c", max:lw3 - 8 }); text("SEVERE TURBULENCE/ICING IS ASSUMED WITH THUNDERSTORMS.", X0 + lw3/2, y2 + 25, 7, { bold:true, color:[255,220,60], align:"c", max:lw3 - 8 });
    const rx2 = X0 + mw + 10; rect(rx2, y2, mw, 14, [255,255,255]); box(rx2, y2, mw, 14, .6); text("HAZARD DISCUSSION", rx2 + mw/2, y2 + 10.5, 9, { bold:true, align:"c" });
    rect(rx2, y2 + 14, mw, 22, [220,40,40]); text("DUE TO LOCAL EFFECTS, HAZARDS ARE SUBJECT TO RAPID CHANGE.", rx2 + mw/2, y2 + 24, 6.5, { bold:true, color:[255,240,120], align:"c", max:mw - 6 }); text("CALL 24/7 OPS CENTER AT 321-853-8485 FOR VALIDATION.", rx2 + mw/2, y2 + 33, 6.5, { bold:true, color:[255,240,120], align:"c", max:mw - 6 });
    y2 += 38; const lh2 = 46;
    HAZ.slice(1).forEach((h, k) => { const c = hex(HCOL[h.c]); rect(X0, y2 + k*lh2, lw3, lh2, c); box(X0, y2 + k*lh2, lw3, lh2, .6); const words = h.t.toUpperCase().split(" "); const half = Math.ceil(words.length/2); const l1 = words.slice(0, half).join(" "), l2 = words.slice(half).join(" "); text(l1, X0 + lw3/2, y2 + k*lh2 + lh2/2 - 1, 10, { align:"c", max:lw3 - 10, color: h.c === "red" ? [80,0,0] : [0,0,0] }); text(l2, X0 + lw3/2, y2 + k*lh2 + lh2/2 + 12, 10, { align:"c", max:lw3 - 10, color: h.c === "red" ? [80,0,0] : [0,0,0] }); });
    box(rx2, y2, mw, lh2*5, .6);
    const disc = String(M.dzDisc || ""); const words = disc.split(/\s+/).filter(Boolean); let ln = "", yy = y2 + lh2*2.2;
    const lines = []; for (const wd of words){ const t2 = ln ? ln + " " + wd : wd; if (textW(t2, 10, false) > mw - 20 && ln){ lines.push(ln); ln = wd; } else ln = t2; } if (ln) lines.push(ln);
    lines.slice(0, 8).forEach((l2, k) => text(l2, rx2 + mw/2, yy + k*13, 10, { align:"c" }));
    kathyLines().slice().reverse().forEach((l2, k) => text(l2.replace(/°/g, " deg"), rx2 + mw/2, y2 + lh2*5 - 8 - k*10, k === kathyLines().length - 1 ? 7.5 : 6.8, { bold: k === kathyLines().length - 1, align:"c", max:mw - 10 }));
    const missing = DZS.length - dzWithPos().length; if (DEMO || missing) text(DEMO ? "Demo mode: drop zone positions are made up." : `${missing} drop zone(s) not shown: position not loaded.`, X0, Math.min(Hp - 16, y2 + lh2*5 + 12), 6.5, { color:[90,100,110] });
    pages.push(cs);
  }
  return pdfAssemble(pages.map(q => q.join("\n")), logo, W, Hp, { image2: seal });
}
const fileBase = () => `${PR().short.replace(/\s+/g, "_")}_${M.block}_${(M.date || todayLocal()).replace(/-/g, "")}${M.mef ? "_" + M.mef.replace(/[^A-Za-z0-9-]+/g, "") : ""}`;
function download(blob, name){ const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
function htmlMWP(){
  const css = document.getElementById("prodcss").textContent;
  const inline = s => s.replace(/src="([^"]+)"/g, (m0, u) => u.startsWith("data:") ? m0 : m0);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(PR().short)} ${esc(M.block)} ${dateLabel()}</title><style>${css} body{margin:0;padding:16px;background:#fff;font-family:Arial,Helvetica,sans-serif}</style></head><body>${inline($("preview").innerHTML)}</body></html>`;
}

/* ---------- demo ---------- */
function demoWx(){
  const t0 = Math.floor(Date.now()/H)*H - 24*H, times = Array.from({ length:96 }, (_, k) => t0 + k*H);
  const di = t => Math.sin(((+lH(t)) - 9)/24*2*Math.PI);
  const out = { times, t:times.map(t => 27 + 3*di(t)), td:times.map(() => 23), slp:times.map((t, k) => 1013 + Math.sin(k/6)), fz:times.map(() => 4700), w10:times.map(() => ({ s:8, d:110 })), w80:times.map(() => ({ s:11, d:115 })), lev:{} };
  PLV.forEach((l, k) => out.lev[l] = { t:times.map((t, i) => out.t[i] - 1 - k*1.8), z:times.map(() => [110, 330, 560, 790, 1020, 1500][k]), w:times.map(() => ({ s:12 + k*2, d:120 + k*5 })) });
  return out;
}
function demoTAF(id){
  const br = blockRange(), d = new Date(br.a - 6*H), dd = p2(d.getUTCDate()), hh = p2(d.getUTCHours()), e = new Date(br.a + 24*H), ed = p2(e.getUTCDate()), eh = p2(e.getUTCHours()), mid = new Date(br.a + 6*H);
  const fm = `${p2(mid.getUTCDate())}${p2(mid.getUTCHours())}`;
  if (id === "KCOF" || id === "KTTS") return `TAF ${id} ${dd}${hh}00Z ${dd}${hh}/${ed}${eh} 13010KT 9999 SCT030 QNH2998INS\nBECMG ${fm}/${p2(mid.getUTCDate())}${p2((mid.getUTCHours() + 1) % 24)} 11012G20KT 4800 -TSRA BKN030CB QNH2995INS\nTEMPO ${fm}/${p2(mid.getUTCDate())}${p2((mid.getUTCHours() + 3) % 24)} 1600 TSRA BKN008CB`;
  return `TAF ${id} ${dd}${hh}20Z ${dd}${hh}/${ed}${eh} 12008KT P6SM SCT035\n FM${fm}00 11010KT P6SM VCTS SCT030CB BKN100\n TEMPO ${fm}/${p2(mid.getUTCDate())}${p2((mid.getUTCHours() + 3) % 24)} 3SM TSRA BKN012CB`;
}
function demoDZ(){ const br = blockRange(), times = Array.from({ length:48 }, (_, k) => (Math.floor(br.a/H) - 6 + k)*3600); return Object.fromEntries(dzWithPos().map((d, j) => [d.id, { time:times, weather_code:times.map((t, k) => j % 4 === 0 && k > 12 && k < 15 ? 95 : 2), cape:times.map(() => j % 3 === 0 ? 1500 : 300), precipitation_probability:times.map(() => 40), wind_gusts_10m:times.map(() => 18 + j) }])); }
function demoMarine(){
  const now = Date.now(), t = k => new Date(now - k*1800e3).toISOString().replace(/:\d\d\.\d+Z$/, ":00Z");
  const [y, mo, d] = (M.date || todayLocal()).split("-").map(Number), wd = new Date(Date.UTC(y, mo - 1, d, 12)).toLocaleDateString("en-US", { weekday:"long", timeZone:"UTC" });
  const per = (name, s) => ({ name, text:`East winds 10 to 15 knots. Seas ${s}. Wave Detail: E 2 ft at 7 seconds and NE 1 foot at 10 seconds. Isolated showers and thunderstorms.` });
  const periods = [per("Today", "2 to 3 ft"), per("Tonight", "2 ft"), per(wd, "2 to 3 ft"), per(`${wd} Night`, "2 ft")];
  return { buoys:{ "41009":{ name:"Canaveral 20 nm east", obs:[{ t:t(1), wdir:100, wspd_ms:6, gst_ms:8, wvht_m:0.9, dpd_s:7, mwd:95, atmp_c:27, wtmp_c:27.9 }] }, "41113":{ name:"Cape Canaveral nearshore", obs:[{ t:t(1), wvht_m:0.6, dpd_s:6, mwd:90, wtmp_c:27.6 }] } },
    cwf:{ AMZ572:{ periods }, AMZ552:{ periods: periods.map(p => ({ ...p, text:p.text.replace(/Seas [^.]+/, "Seas 1 to 2 ft") })) } } };
}
function demoSea(){ const t0 = Math.floor(Date.now()/H)*3600 - 24*3600, time = Array.from({ length:96 }, (_, k) => t0 + k*3600); const h = { time, wave_height:time.map(() => 0.8), wave_period:time.map(() => 7), wave_direction:time.map(() => 90), sea_surface_temperature:time.map(() => 27.8) }; return { buoy:h, kathy:{ ...h, wave_height:time.map(() => 0.6) } }; }

/* ---------- load and bind ---------- */
async function loadAll(){
  G.status = { TAFs:"loading", models:"loading", DZ:"loading", ocean:"loading" }; renderStatus();
  const ids = [...new Set([PR().stn, ...PR().alts])];
  await Promise.all([
    fetchTAFs(ids).then(x => { G.alts = Object.assign({}, G.alts, x); G.status.TAFs = `${Object.keys(x).length} of ${ids.length}`; }).catch(() => { G.status.TAFs = "not reachable (paste them below)"; }),
    fetchWx().then(x => { G.wx = x; G.status.models = "loaded"; }).catch(() => { G.status.models = "not reachable"; }),
    (PR().dz ? fetchDZ().then(x => { G.dz = x; G.status.DZ = "loaded"; }).catch(() => { G.status.DZ = "not reachable"; }) : Promise.resolve(G.status.DZ = "n/a")),
    fetchSea().then(x => { G.sea = x; G.status.ocean = "model loaded"; }).catch(() => { G.status.ocean = "model not reachable"; }),
    fetchMarineObs().then(x => { G.buoys = x.buoys; G.cwf = x.cwf; G.status.marine = `${x.cwf ? "NWS seas" : "no NWS seas"}, ${x.buoys ? "buoys" : "no buoys"}`; }).catch(() => { G.status.marine = "not reachable"; }),
  ]);
  if (DEMO) G.status.mode = "demo (synthetic data)";
  renderAll();
}
function bind(){
  $("prodSel").onclick = e => { const b = e.target.closest("[data-p]"); if (!b) return; M.prod = b.dataset.p; save(); loadAll(); };
  $("blkSel").onclick = e => { const b = e.target.closest("[data-b]"); if (!b) return; M.block = b.dataset.b; M.flHour = null; save(); loadAll(); };
  $("blkA").onchange = $("blkB").onchange = () => { const a = Math.max(0, Math.min(23, +$("blkA").value)), b = Math.max(a + 1, Math.min(30, +$("blkB").value)); M.blocks[M.block] = [a, b]; M.flHour = null; save(); renderAll(); };
  $("mdate").onchange = e => { M.date = e.target.value || null; M.flHour = null; save(); loadAll(); };
  $("mfc").oninput = e => { M.fc = e.target.value.toUpperCase(); save(); renderProduct(); };
  $("mmef").oninput = e => { M.mef = e.target.value; save(); renderProduct(); };
  $("tafSrc").onchange = e => { M.tafSrc = e.target.value; save(); renderAll(); };
  $("flHour").onchange = e => { M.flHour = +e.target.value; save(); renderProduct(); };
  ["watch","warning","advisory"].forEach(k => $("w_" + k).oninput = e => { M.wwa[k] = e.target.value; save(); renderProduct(); });
  $("tbl").addEventListener("input", e => { const td = e.target.closest("[data-c]"); if (!td) return; const t = +td.dataset.t, c = td.dataset.c, v = td.textContent.trim(); const auto = model().rows.find(r => r.t === t).auto[c]; if (v === auto || v === "") delete M.ov[ovKey(t, c)]; else M.ov[ovKey(t, c)] = v; save(); td.classList.toggle("ov", M.ov[ovKey(t, c)] !== undefined); renderProduct(); });
  $("tbl").addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); e.target.blur(); } });
  $("resetOv").onclick = () => { const pre = `${M.prod}|`; for (const k of Object.keys(M.ov)) if (k.startsWith(pre)) delete M.ov[k]; save(); renderAll(); };
  $("dzRows").addEventListener("change", e => { const s = e.target.closest("[data-dz]"); if (s){ M.dz[s.dataset.dz] = s.value; save(); renderAll(); return; } const q = e.target.closest("[data-dzp]"); if (q){ const raw = q.value.trim(), v = parseCoord(raw); const p = M.dzPos[q.dataset.dzp] = M.dzPos[q.dataset.dzp] || {}; if (raw === "") delete p[q.dataset.k]; else if (v != null) p[q.dataset.k] = q.dataset.k === "lon" && v > 0 ? -v : v; else { toast("Use decimal degrees, or degrees and minutes like 28 15.500"); return; } p.est = false; save(); loadAll(); } });
  $("dzOpen").onchange = async e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; try { const n = importDZ(await f.text()); toast(`Loaded ${n} drop zone position${n === 1 ? "" : "s"}`); loadAll(); } catch (err) { toast("Couldn't read that file: " + err.message); } };
  $("dzSaveFile").onclick = () => { const out = { kind:"erwx-dz-positions", version:1, saved:new Date().toISOString(), positions:Object.fromEntries(DZS.map(d => [d.id, M.dzPos[d.id]]).filter(([, p]) => p && p.lat != null && p.lon != null).map(([id, p]) => [id, { name:DZS.find(d => d.id === id).name, lat:p.lat, lon:p.lon }])) }; download(new Blob([JSON.stringify(out, null, 2)], { type:"application/json" }), "DZ_Positions.json"); };
  $("dzClear").onclick = () => { if (!confirm("Remove the drop zone positions stored on this computer?")) return; M.dzPos = {}; save(); loadAll(); };
  $("dzDisc").oninput = e => { M.dzDisc = e.target.value; save(); renderProduct(); };
  $("altEdit").onclick = () => { const d = $("altDlg"); $("altBody").innerHTML = PR().alts.map(id => `<label>${id}<textarea data-alt="${id}" rows="5">${esc(M.altPaste[id] || G.alts[id] || "")}</textarea></label>`).join(""); d.showModal(); };
  $("altSave").onclick = () => { document.querySelectorAll("[data-alt]").forEach(t => { const id = t.dataset.alt, v = t.value.trim(); if (v && v !== (G.alts[id] || "").trim()) M.altPaste[id] = v; else delete M.altPaste[id]; }); save(); $("altDlg").close(); renderAll(); };
  $("altClose").onclick = () => $("altDlg").close();
  $("pdfBtn").onclick = async () => download(await pdfMWP(), fileBase() + ".pdf");
  $("htmlBtn").onclick = () => download(new Blob([htmlMWP()], { type:"text/html" }), fileBase() + ".html");
  $("reload").onclick = () => loadAll();
  document.querySelectorAll(".pagenav a").forEach(a => { if (/mwp\.html$/.test(a.getAttribute("href"))) a.setAttribute("aria-current", "page"); });
}
bind(); renderControls(); loadAll();
