"use strict";
/* ============================================================
   LMEF editor configuration (loaded before planning-app.js)
   Hourly rows across every launch window, one row per
   NASA-STD-4010B lightning launch commit criterion, the vehicle
   liftoff wind constraint and an hourly probability of violation.
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
/* vehicle constraint values are entered by the forecaster and kept on this computer only */
const VEHICLE_LIMITS = {};
const BUILTIN_RISKS = [
  { id:"shear",    name:"Upper-Level Wind Shear",   auto:"GFS 300-200 hPa winds" },
  { id:"recovery", name:"Booster Recovery Weather", auto:"recovery site winds and seas" },
  { id:"proton",   name:"Solar Activity",           auto:"GOES ≥10 MeV protons and the SWPC 3-day forecast" },
  /* set by the forecaster (no automatic value); turned on by the mission profiles that use them */
  { id:"ascent",   name:"Ascent Corridor Weather",  auto:null },
  { id:"padesc",   name:"Pad Escape Winds",         auto:null },
  { id:"capsule",  name:"Capsule Return Weather",   auto:null },
  { id:"offshore", name:"Offshore Landing Weather", auto:null },
];
/* mission profiles (from the legacy LMEF builder): provider -> profiles; each profile sets the number
   of forecast days and which additional risk criteria appear */
const PROVIDERS = {
  "SPACEX": ["Non-Dragon F9/FH", "Crew Dragon", "Cargo Dragon", "Free-Flyer", "Starship"],
  "UNITED LAUNCH ALLIANCE (ULA)": ["Atlas", "Vulcan"],
  "NASA": ["NASA Default"],
  "BLUE ORIGIN": ["Blue Origin Default"],
  "RANGE SUPPORT": ["Navy", "Boeing"],
  "US NAVY": ["Navy"],
  "OTHER": ["Default"],
};
const PROFILE_RISKS = {
  "Non-Dragon F9/FH": ["proton", "recovery"],
  "Crew Dragon": ["proton", "recovery", "ascent", "padesc"],
  "Cargo Dragon": ["proton", "recovery"],
  "Free-Flyer": ["proton", "ascent", "padesc", "capsule"],
  "Starship": ["proton"], "Atlas": ["proton"], "Vulcan": ["proton"], "NASA Default": ["proton"],
  "Blue Origin Default": ["proton", "offshore"],
  "Navy": [], "Boeing": [], "Default": ["proton"],
};
const PROFILE_DAYS = { "Crew Dragon": 3, "Cargo Dragon": 3 };
/* the provider and profile a mission most likely is, from its provider, name and vehicle */
function guessProfile(provider, name, vehicle){
  const p = String(provider || ""), n = String(name || ""), v = String(vehicle || "");
  const prov = /space\s*x/i.test(p) || /falcon|starship/i.test(v) ? "SPACEX" : /ula|united launch/i.test(p) || /atlas|vulcan/i.test(v) ? "UNITED LAUNCH ALLIANCE (ULA)"
    : /blue origin/i.test(p) || /new glenn/i.test(v) ? "BLUE ORIGIN" : /navy/i.test(p) ? "US NAVY" : /range support|boeing/i.test(p) ? "RANGE SUPPORT" : /nasa/i.test(p) || /\bSLS\b/i.test(v) ? "NASA" : "OTHER";
  let prof = PROVIDERS[prov][0];
  if (prov === "SPACEX") prof = /crew/i.test(n) ? "Crew Dragon" : /\bCRS\b/i.test(n) ? "Cargo Dragon" : /starship/i.test(n) || /starship/i.test(v) ? "Starship" : "Non-Dragon F9/FH";
  if (prov === "UNITED LAUNCH ALLIANCE (ULA)") prof = /atlas/i.test(v) || /atlas/i.test(n) ? "Atlas" : "Vulcan";
  if (prov === "RANGE SUPPORT") prof = /boeing/i.test(p) || /boeing/i.test(n) ? "Boeing" : "Navy";
  return { provider:prov, profile:prof };
}
const LS2 = {
  get(d){ try { const v = localStorage.getItem(LMK); return v ? JSON.parse(v) : d; } catch (e){ return d; } },
  set(v){ try { localStorage.setItem(LMK, JSON.stringify(v)); } catch (e){ /* storage unavailable */ } },
};
const L = Object.assign({ mission:"", vehicle:"Falcon 9", pad:"slc40", windows:null, discussion:"", next:"As Required", days:[], missionId:"",
  liftoff:{ h:200, kind:"peak", op:">", v:30, unit:"kt" }, ftp:false, risks:null, recovery:[] }, LS2.get({}));
if (!L.windows){
  if (L.w0) L.windows = [{ a:L.w0, b:L.w1 }, { a:L.d0 || L.w0 + 24*H, b:L.d1 || L.w1 + 24*H }];
  else { const t = Math.ceil(Date.now()/H)*H + 26*H; L.windows = [{ a:t, b:t + 4*H }, { a:t + 24*H, b:t + 28*H }]; }
  if (L.limit) L.liftoff.v = L.limit;
}
if (!Array.isArray(L.days)) L.days = [];
if (!L.risks) L.risks = BUILTIN_RISKS.map(r => ({ id:r.id, name:r.name, on:true, builtin:true }));
/* the solar activity row (GOES protons): older saves called it "solar" or "Proton Flux" */
L.risks.forEach(r => { if (r.id === "solar") r.id = "proton"; if (r.id === "proton" && (!r.name || r.name === "Proton Flux")) r.name = "Solar Activity"; });
/* criteria added since this computer last saved: present but off */
BUILTIN_RISKS.forEach(b => { if (!L.risks.some(r => r.id === b.id)) L.risks.push({ id:b.id, name:b.name, on:false, builtin:true }); });
if (L.nextAuto === undefined) L.nextAuto = true;
const saveL = () => LS2.set(L);
const winLabel = i => i === 0 ? "Launch day" : `${i*24}-hour delay`;
const LIFT_UNITS = { kt:1, mph:0.868976, "m/s":1.943844, "ft/s":0.592484, "km/h":0.539957 };
const liftoffKt = () => (+L.liftoff.v || 0)*(LIFT_UNITS[L.liftoff.unit] || 1);
const liftoffH = () => Math.round(+L.liftoff.h) || 200;
const liftoffKey = () => (L.liftoff.kind === "sust" ? "s" : "g") + liftoffH();
const liftoffText = () => `${L.liftoff.kind === "sust" ? "sustained" : "peak"} ${L.liftoff.op === ">=" ? "≥" : ">"} ${L.liftoff.v} ${L.liftoff.unit} at ${L.liftoff.h} ft`;

/* ---------- NASA-STD-4010B lightning launch commit criteria ----------
   The guidance can't see each rule directly (cloud tops, anvil age, field mills), so each rule is
   estimated from what it can see: calibrated thunder and LAMP/MOS thunder for the electrified-cloud
   rules, precipitation and low cloud for the cumulus rule, deep mid-level cloud for thick layers.
   These are first guesses for the forecaster; every hour is editable. */
const RULES = [
  { k:"rl",  name:"Lightning",               product:"Lightning Rule",               title:"Lightning rule: flash within 10 nmi in the last 30 min (thunder within the hour and the hour before)" },
  { k:"rcu", name:"Cumulus Cloud",           product:"Cumulus Cloud Rule",           title:"Cumulus cloud rule: cumulus with tops colder than 0 °C near the flight path (from showers, thunder and low cloud)" },
  { k:"raa", name:"Attached Anvil",          product:"Attached Anvil Cloud Rule",    title:"Attached anvil cloud rule: anvil attached to a nearby thunderstorm" },
  { k:"rda", name:"Detached Anvil",          product:"Detached Anvil Cloud Rule",    title:"Detached anvil cloud rule (detached anvil from storms in the previous 3 hours)" },
  { k:"rdb", name:"Debris Cloud",            product:"Debris Cloud Rule",            title:"Debris cloud rule (debris cloud left by storms in the previous 3 hours)" },
  { k:"rdw", name:"Disturbed Weather",       product:"Disturbed Weather Rule",       title:"Disturbed weather rule (broken or overcast clouds extending above the freezing level with moderate precipitation)" },
  { k:"rtc", name:"Thick Cloud Layers",      product:"Thick Cloud Layers Rule",      title:"Thick cloud layers rule (cloud layers 4,500 ft thick or more in the 0 to -20 °C layer)" },
  { k:"rsm", name:"Smoke Plume",             product:"Smoke Plume Cloud Rule",       title:"Smoke plume cloud rule: cumulus formed from smoke plumes (set by the forecaster)" },
  { k:"ref", name:"Surface Electric Fields", product:"Surface Electric Field Rule",  title:"Surface electric field rule (field mill readings at or above the limit within 5 nmi)" },
];
const CONVECTIVE = ["rl","rcu","raa","rda","rdb","rdw","ref"];
/* PoV from rule chances: the electrified-cloud rules are strongly related, so they count as one
   group (the largest rule plus 35 % of the remainder); the other constraints add independently */
function povFrom(get){
  const conv = CONVECTIVE.map(get).filter(v => v != null).map(v => v/100);
  let pc = 0;
  if (conv.length){ const mx = Math.max(...conv); const rest = 1 - conv.reduce((q, v) => q*(1 - v), 1)/(1 - mx || 1); pc = mx + 0.35*(1 - mx)*Math.max(0, Math.min(1, rest)); }
  const ind = ["rtc","rsm","rftp","xlw"].map(get).filter(v => v != null).map(v => v/100);
  const p = 1 - (1 - pc)*ind.reduce((q, v) => q*(1 - v), 1);
  return Math.round(Math.min(1, p)*100);
}

/* ---------- editor hooks ---------- */
window.EDITOR_HOOKS = window.EDITOR_HOOKS || {};
const EH = window.EDITOR_HOOKS;
/* rows: hourly across every window */
EH.rows = () => {
  const set = new Set();
  for (const w of L.windows || []){ if (!w.a || !w.b) continue; for (let t = Math.floor(w.a/H)*H; t < Math.max(w.b, w.a + 1); t += H) set.add(t); }
  const ts = [...set].sort((a, b) => a - b);
  return finishRows(ts.map(a => ({ a, b:a + H, len:1 })));
};
/* the pad, the wind heights and the parameter list */
EH.config = () => {
  const pad = PADS.find(p => p.id === L.pad) || PADS[2];
  SITES.splice(0, SITES.length, { id:pad.id, name:pad.name, point:pad.name, stn:pad.stn, lat:pad.lat, lon:pad.lon, tag:pad.name.replace(/^S?LC-/, ""), area:pad.full });
  const h = liftoffH();
  HEIGHTS.splice(0, HEIGHTS.length, ...[...new Set([200, h])].sort((a, b) => a - b));
  const base = k => ({ ...PLANNING_PARAMS.find(p => p.k === k) });
  const rule = r => ({ k:r.k, g:"LLCC rule probability (%)", l:r.name, s:"", kind:"prob", unit:"%", step:5, lo:0, hi:100, title:r.title, chip:r.name, rule:true });
  const lk = liftoffKey(), kt = liftoffKt();
  const winds = HEIGHTS.flatMap(ft => [
    { k:"s" + ft, g:"Winds (kt)", l:`${ft} ft`, s:"sust", kind:"num", unit:"kt", step:1, lo:0, title:`${ft} ft sustained wind`, thr: ft === h ? [Math.round(kt)] : [] },
    { k:"g" + ft, g:"Winds (kt)", l:`${ft} ft`, s:"peak", kind:"num", unit:"kt", step:1, lo:0, title:`${ft} ft peak wind`, thr: ft === h ? [Math.round(kt)] : [], peakOf:"s" + ft },
  ]);
  const list = [
    { k:"rpov", g:"Probability of violation (%)", l:"All rules", s:"hourly", kind:"prob", unit:"%", step:5, lo:0, hi:100, title:"Probability of violation, all rules", chip:"PoV", derived:true },
    ...RULES.map(rule),
    ...(L.ftp ? [{ ...rule({ k:"rftp", name:"Flight Through Precip", title:"Flight through precipitation (vehicle constraint for this mission)" }), g:"Constraints (%)" }] : []),
    { k:"xlw", g:"Constraints (%)", l:"Liftoff winds", s:liftoffText(), kind:"prob", unit:"%", step:1, lo:0, hi:100, ex:lk, dep:[lk], op:L.liftoff.op === ">=" ? ">=" : ">", v:kt, title:`Liftoff winds: ${liftoffText()}`, chip:"Liftoff winds" },
    base("sky"), base("t"), base("td"),
    { ...base("pp1"), g:"Precip / lightning (%)", l:"Precip", s:"1 hr" }, { ...base("lt1"), g:"Precip / lightning (%)", l:"Lightning", s:"1 hr" },
    ...winds, { ...base("dir"), s:"sfc" },
  ];
  PARAMS.splice(0, PARAMS.length, ...list);
  for (const k of Object.keys(P)) delete P[k];
  PARAMS.forEach(p => P[p.k] = p);
};
/* rule guidance for every row, from the sources behind the blend */
EH.agg = (sid, A, G) => {
  const rows = S.rows, srcs = G.src.filter(s => s.members.length || s.iv);
  const win = (ev, a, b) => { const v = srcs.map(s => G.srcWin(s, ev, a, b)).filter(x => x != null); return v.length ? v.reduce((x, y) => x + y, 0)/v.length : null; };
  const mem = []; srcs.forEach(s => s.members.forEach(m => mem.push([m, 1/Math.max(1, s.members.length)])));
  const frac = (i0, i1, f) => { let w = 0, h = 0; for (const [m, wt] of mem){ let any = null; for (let i = i0; i <= i1; i++){ const v = f(m, i); if (v == null) continue; any = any || v; } if (any == null) continue; w += wt; if (any) h += wt; } return w ? h/w : null; };
  const out = {}; RULES.forEach(r => out[r.k] = []); out.rftp = [];
  rows.forEach((r, ri) => {
    const i0 = S.TL.idx(r.a), i1 = Math.min(S.TL.n - 1, S.TL.idx(r.b));
    const tNow = win("tst", r.a - H, r.b) ?? 0, tPrev = win("tst", r.a - 3*H, r.a) ?? 0, pop = win("pop", r.a, r.b) ?? 0;
    const fLow = frac(i0, i1, (m, i) => m.cl && m.cl[i] != null ? m.cl[i] >= 50 : null) ?? 0;
    const fThick = frac(i0, i1, (m, i) => m.cm && m.cm[i] != null ? m.cm[i] >= 75 : null) ?? 0;
    const fDist = frac(i0, i1, (m, i) => m.cm && m.cm[i] != null && m.pr && m.pr[i] != null ? (m.cm[i] >= 60 && m.pr[i] >= 0.25) : null) ?? 0;
    const c = v => Math.round(Math.max(0, Math.min(0.99, v))*100);
    const dist = 0.8*fDist;
    out.rl[ri] = c(tNow);
    out.rcu[ri] = c(Math.min(0.95, 0.55*pop + 0.5*tNow + 0.15*fLow));
    out.raa[ri] = c(0.5*tNow);
    out.rda[ri] = c(0.35*Math.max(tPrev, tNow*0.5));
    out.rdb[ri] = c(0.2*tPrev);
    out.rdw[ri] = c(dist);
    out.rtc[ri] = c(0.6*fThick);
    out.rsm[ri] = 0;
    out.ref[ri] = c(Math.min(0.95, 0.6*tNow + 0.3*dist));
    out.rftp[ri] = c(0.9*pop);
  });
  /* guidance PoV (before the liftoff wind constraint, which the editor adds from the wind members) */
  out.rpov = rows.map((r, ri) => povFrom(k => out[k] && (k !== "rftp" || L.ftp) ? out[k][ri] : null));
  for (const k in out){ A.val[k] = out[k]; A.srcv[k] = A.srcv[k] || {}; A.band[k] = []; }
};
/* hourly PoV from the official rule values, unless the forecaster set it */
EH.official = (res, ed, rows) => {
  const { o, g } = res;
  const calc = src => rows.map((r, i) => povFrom(k => src[k] && src[k][i] != null ? src[k][i] : null));
  if (g){ g.rpov = calc(g); }
  const auto = calc(o);
  o.rpov = rows.map((r, i) => { const x = ed("rpov", r); return x !== undefined ? x : auto[i]; });
};
