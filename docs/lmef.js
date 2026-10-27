"use strict";
/* ============================================================
   Launch Mission Execution Forecast (LMEF) page
   The editor (table and graphs) holds the hourly forecast for every launch
   window; the product is built from those official values. Settings for the
   mission, windows, constraints and risk criteria live in the setup panel.
   ============================================================ */
const CONCERN_NAMES = Object.fromEntries([...RULES.map(r => [r.k, r.product]), ["rftp","Flight Through Precipitation"], ["xlw","Liftoff Winds"]]);
const SX = { launches:[], upper:null, proton:null, recov:{}, lastPad:null };
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
  try { j = await getJSON(`${DATA_BASE}data/launches.json?ts=${Date.now()}`, 8000); } catch (e) { j = null; }
  if (!j || !j.results){
    const c = (() => { try { return JSON.parse(localStorage.getItem("lmef:ll2") || "null"); } catch (e) { return null; } })();
    if (c && Date.now() - c.t < 3600e3) j = c.j;
    else {
      try {
        j = await getJSON("https://ll.thespacedevs.com/2.2.0/launch/upcoming/?location__ids=12,27&limit=15", 15000);
        if (!j || !(j.results || []).length) j = await getJSON("https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=40", 15000);
        try { localStorage.setItem("lmef:ll2", JSON.stringify({ t:Date.now(), j })); } catch (e) {}
      }
      catch (e) { j = c ? c.j : null; }
    }
  }
  const fl = r => /Cape Canaveral|Kennedy|Florida/i.test(((r.pad || {}).location || {}).name || (r.pad || {}).name || "");
  const res = ((j && j.results) || []).filter(fl);
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
    let j = null; try { j = await getJSON(`${DATA_BASE}data/protons.json?ts=${Date.now()}`, 8000); } catch (e) { j = null; }
    if (!j) j = await getJSON("https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json", 15000);
    const ten = (Array.isArray(j) ? j : []).filter(r => /10 MeV/.test(r.energy || "") && r.flux != null);
    if (ten.length) out.now = +ten[ten.length - 1].flux;
  } catch (e) { /* unavailable */ }
  try {
    let t = null; try { const r = await fetch(`${DATA_BASE}data/3day.txt?ts=${Date.now()}`, { cache:"no-store" }); if (r.ok) t = await r.text(); } catch (e) { t = null; }
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


/* ---------- extra inputs for the risk criteria ---------- */
function loadExtras(){
  const pad = PADS.find(p => p.id === L.pad) || PADS[2];
  fetchUpper(pad).then(u => { SX.upper = u; refreshProduct(); }).catch(() => {});
  fetchProton().then(k => { SX.proton = k; refreshProduct(); }).catch(() => {});
  loadRecovery();
}
const sched = () => refreshProduct();

/* ---------- product values for one window, from the official forecast ---------- */
const median = a => { a = a.filter(v => v != null && isFinite(v)).sort((x, y) => x - y); if (!a.length) return null; const k = a.length >> 1; return a.length % 2 ? a[k] : (a[k - 1] + a[k])/2; };
const KT2MPH = 1.150779;
const r5 = v => Math.max(5, Math.min(95, Math.round(v/5)*5));
function derive(i){
  const w = (L.windows || [])[i]; if (!w) return {};
  if (w.b < Date.now() - 30*60e3) return { past:true };
  const sid = SITES[0].id, OFs = typeof officialFor === "function" && S.agg[sid] ? officialFor(sid) : null;
  if (!OFs || !S.rows) return { pending:true };
  const o = OFs.o, rows = S.rows;
  /* rows inside the window, weighted by how much of each hour the window covers */
  const inW = rows.map((r, ri) => [ri, Math.max(0, Math.min(r.b, w.b) - Math.max(r.a, w.a))/H]).filter(x => x[1] > 0 || (w.b === w.a && rows[x[0]].a <= w.a && rows[x[0]].b > w.a));
  if (!inW.length) return { outOfRange:true };
  const wsum = inW.reduce((s, x) => s + (x[1] || 1), 0);
  const wmean = k => { let s = 0, n = 0; for (const [ri, wt] of inW){ const v = o[k] && o[k][ri]; if (v == null) continue; s += v*(wt || 1); n += (wt || 1); } return n ? s/n : null; };
  const wmax = k => { const v = inW.map(([ri]) => o[k] && o[k][ri]).filter(x => x != null); return v.length ? Math.max(...v) : null; };
  const pov = wmean("rpov");
  const ranks = Object.keys(CONCERN_NAMES).filter(k => P[k]).map(k => [k, wmean(k) ?? 0]).sort((a, b) => b[1] - a[1]);
  const concerns = ranks.filter(x => x[1] >= 5).slice(0, 2).map(x => CONCERN_NAMES[x[0]]);
  /* PoV through the window: hourly up to 12 h, then 2- or 3-hour pieces */
  let seg = null;
  if ((w.b - w.a)/H >= 2){
    const step = inW.length <= 12 ? 1 : inW.length <= 24 ? 2 : 3; seg = [];
    for (let k = 0; k < inW.length; k += step){
      const part = inW.slice(k, k + step); const a = Math.max(rows[part[0][0]].a, w.a), b = Math.min(rows[part[part.length - 1][0]].b, w.b);
      const v = part.map(([ri]) => o.rpov[ri]).filter(x => x != null);
      seg.push({ a, b, pov: v.length ? r5(v.reduce((x, y) => x + y, 0)/v.length) : null });
    }
  }
  const midRi = inW[Math.floor(inW.length/2)][0];
  const pp = wmax("pp1") ?? 0, lt = wmax("lt1") ?? 0;
  const wx = lt >= 30 ? "Thunderstorms" : pp >= 40 ? "Showers" : pp >= 20 ? "Isolated showers" : "None";
  const T = o.t[midRi], Td = o.td[midRi];
  const dir = o.dir[midRi], sLo = Math.min(...inW.map(([ri]) => o.s200[ri]).filter(v => v != null)), gHi = wmax("g200");
  const lo = isFinite(sLo) ? Math.max(0, Math.floor(sLo*KT2MPH/5)*5) : null, hi = gHi != null ? Math.max((lo ?? 0) + 5, Math.ceil(gHi*KT2MPH/5)*5) : null;
  /* clouds and visibility come from the guidance members */
  const G = S.G[sid], TL = S.TL, i0 = TL.idx(Math.floor(w.a/H)*H), i1 = Math.min(TL.n - 1, TL.idx(Math.ceil(w.b/H)*H));
  const mem = G ? G.src.flatMap(s => s.members) : [];
  const mx = (m, k) => { let v = null; for (let x = i0; x <= i1; x++){ const q = m[k] && m[k][x]; if (q != null && (v == null || q > v)) v = q; } return v; };
  const mn = (m, k) => { let v = null; for (let x = i0; x <= i1; x++){ const q = m[k] && m[k][x]; if (q != null && (v == null || q < v)) v = q; } return v; };
  const vis = median(mem.map(m => mn(m, "vis"))), visMi = vis == null ? 7 : Math.min(7, Math.max(0, Math.round(vis/1609.34)));
  const cl = median(mem.map(m => mx(m, "cl"))), cm = median(mem.map(m => mx(m, "cm"))), ch = median(mem.map(m => mx(m, "ch")));
  const lcb = median(mem.map(m => mn(m, "lcb")).filter(v => v != null && v < 12000));
  const cov = p => p == null || p < 6.25 ? null : p < 31.25 ? "Few" : p < 56.25 ? "Scattered" : p < 93.75 ? "Broken" : "Overcast";
  const rr = v => Math.round(v/500)*500, conv = Math.min(1, (pp + lt)/100);
  const clouds = [];
  if (cov(cl)){ const base = rr(lcb != null ? Math.max(1000, lcb) : 4000); clouds.push({ type: cl >= 75 ? "Stratocumulus" : "Cumulus", cov:cov(cl), base, tops: rr(base + 4000 + 14000*conv) }); }
  if (cov(cm)) clouds.push({ type: cm >= 75 ? "Altostratus" : "Altocumulus", cov:cov(cm), base:12000, tops:16000 });
  if (cov(ch)) clouds.push({ type: ch >= 75 ? "Cirrostratus" : "Cirrus", cov:cov(ch), base:28000, tops:35000 });
  if (!clouds.length) clouds.push({ type:"None", cov:"", base:null, tops:null });
  /* additional risk criteria */
  const A = w.a, B = w.b, risk = {}, why = {};
  if (SX.upper && SX.upper.t.length){ const v = SX.upper.t.map((t, k) => t >= Math.floor(A/H)*H && t <= Math.ceil(B/H)*H ? SX.upper.max[k] : null).filter(x => x != null); const m = v.length ? Math.max(...v) : 0; risk.shear = RISK[m >= 140 ? 2 : m >= 100 ? 1 : 0]; why.shear = `jet up to ${Math.round(m)} kt`; }
  if (SX.proton){
    const dayP = (SX.proton.days || []).filter(x => A < x.d + 86400e3 && B > x.d).map(x => x.p);
    const p = dayP.length ? Math.max(...dayP) : null, now = SX.proton.now, soon = A - Date.now() < 12*H;
    risk.proton = RISK[(soon && now != null && now >= 100) || (p != null && p >= 50) ? 2 : (soon && now != null && now >= 10) || (p != null && p >= 10) ? 1 : 0];
    why.proton = [now != null ? `${now < 1 ? now.toFixed(2) : Math.round(now)} pfu now` : "", p != null ? `S1+ ${p}%` : "beyond the 3-day forecast"].filter(Boolean).join(", ");
  }
  const rec = recoveryEval(A, B);
  if (rec.length){ risk.recovery = RISK[Math.max(...rec.map(r => r.lv))]; why.recovery = rec.map(r => `${r.name}: gusts ${r.gmax == null ? "–" : Math.round(r.gmax) + " kt"}, seas ${r.wmax == null ? "–" : r.wmax.toFixed(1) + " ft"}`).join("; "); }
  return {
    pov: pov == null ? null : r5(pov), concerns: concerns.length ? concerns.join(", ") : "None", seg, wx, vis:`${visMi} mi.`,
    temp: T == null ? "" : `${Math.round(T)}°F`, rh: T != null && Td != null ? `${Math.round(rhFrom((T - 32)*5/9, (Td - 32)*5/9))}%` : "",
    wind: lo == null || dir == null ? "" : `${String(Math.round(dir/10)*10 || 360).padStart(3, "0")}° ${lo} - ${hi} mph`, clouds, risk, why, ranks,
  };
}
/* what the product shows: the derived values, with any field the forecaster overrode */
const OV_FIELDS = ["pov","concerns","wx","vis","temp","rh","wind"];
function dayData(i){
  const d = derive(i), ov = (L.days[i] && L.days[i].ov) || {}, out = { ...d };
  for (const f of OV_FIELDS) if (ov[f] !== undefined) out[f] = ov[f];
  if (ov.clouds) out.clouds = ov.clouds;
  out.risk = { ...(d.risk || {}) };
  for (const r of L.risks){ if (ov.risk && ov.risk[r.id]) out.risk[r.id] = ov.risk[r.id]; else if (!out.risk[r.id]) out.risk[r.id] = "Low"; }
  out.showSeg = !(L.days[i] && L.days[i].showSeg === false);
  return out;
}
function draftDiscussion(){
  const g = dayData(0); if (!g || g.pending || g.outOfRange) return "";
  const sky = g.clouds && g.clouds[0] && g.clouds[0].type !== "None" ? `${g.clouds[0].cov.toLowerCase()} ${g.clouds[0].type.toLowerCase()}` : "mostly clear skies";
  const wxs = g.wx === "None" ? "no precipitation expected during the window" : `${g.wx.toLowerCase()} possible during the window`;
  const conc = g.concerns === "None" ? "Weather is not expected to be a concern for the primary window." : `The main concern for the primary window is the ${g.concerns.split(", ").join(" and the ")}.`;
  let s = `Guidance shows ${sky} at the pad with ${wxs}. ${g.wind ? `Liftoff winds at 200 ft are forecast from ${g.wind.replace(/^(\d+)°\s*/, "$1° at ")}. ` : ""}${conc}`;
  (L.windows || []).slice(1).forEach((w, k) => { const d = dayData(k + 1); if (d && d.pov != null) s += ` For the ${winLabel(k + 1)}, the probability of violation is ${d.pov}%${d.concerns && d.concerns !== "None" ? `, mainly for the ${d.concerns.split(", ")[0]}` : ""}.`; });
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
    const D = dayData(i); const [pc, pl] = POVC(+D.pov || 0);
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
      ${logo ? `<img src="data:image/png;base64,${logo.b64}" alt="45th Weather Squadron">` : `<img src="${LOGO_SRC}" alt="45th Weather Squadron" onerror="this.remove()">`}
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
const LM_CSS = `.schline{margin:-4px 0 4px;font-size:12px}.schline .fileb{position:relative;overflow:hidden;padding:2px 8px;font-size:12px}.schline .fileb input{position:absolute;inset:0;opacity:0;cursor:pointer}.pdffmt{display:inline-flex;gap:6px;align-items:center;font-size:13px;color:var(--ink-2)}.pdffmt select{border:1px solid var(--rule);border-radius:7px;padding:5px 7px;background:var(--panel);color:var(--ink)}.sealrow{margin:6px 0 0;text-align:right}.sealrow .fileb{position:relative;overflow:hidden;padding:2px 8px;font-size:12px}.sealrow .fileb input{position:absolute;inset:0;opacity:0;cursor:pointer}
.lm{font-family:"Barlow","Segoe UI",Arial,sans-serif;color:#13202E;background:#fff;max-width:900px;margin:0 auto;border-radius:14px;overflow:hidden;box-shadow:0 1px 0 #D4DBDF}
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
    const D = dayData(i), lab = winLabel(i);
    out.push([`${lab} window`, winText(w.a, w.b)], [`${lab} PoV`, `${D.pov ?? ""}%`]);
    if (segOn(D)){ D.seg.forEach(sg => out.push([`${lab} PoV ${lHM(sg.a)}–${lHM(sg.b)}L`, `${sg.pov}%`])); out.push([`${lab} PoV through the window`, segSummary(D)]); }
    out.push( [`${lab} primary concerns`, D.concerns], [`${lab} weather/visibility`, `${D.wx || ""} / ${D.vis || ""}`], [`${lab} temperature/humidity`, `${D.temp || ""} / ${D.rh || ""}`], [`${lab} liftoff winds (200 ft)`, D.wind]);
    (D.clouds || []).forEach((c, k) => out.push([`${lab} cloud layer ${k + 1}`, c.type === "None" ? "None" : `${c.type}, ${c.cov}, base ${c.base ?? "-"} ft, tops ${c.tops ?? "-"} ft`]));
    risksOn().forEach(r => out.push([`${lab} ${r.name.toLowerCase()}`, (D.risk || {})[r.id] || "Low"]));
  });
  out.push(["Next forecast will be issued", L.next]);
  return out;
}
/* ---------- database-ready CSV ----------
   Two tidy tables sharing forecast_id: one row per window, and one row per hour of each window.
   Fixed snake_case columns, ISO 8601 UTC times, plain numbers without units, empty for unknown. */
const LMEF_CSV_VERSION = "lmef-csv-1";
const csvq = v => { if (v == null || (typeof v === "number" && !isFinite(v))) return ""; const t = String(v); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const isoZ = ms => ms == null || !isFinite(ms) ? "" : new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const slug = t => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const numIn = t => { const m = String(t ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; };
function forecastId(){ return `${slug(L.mission || "mission")}_${isoZ(L.issued || Date.now()).replace(/[-:]/g, "")}`; }
function windowKey(i){ return i === 0 ? "launch_day" : slug(winLabel(i)); }
function parseWind(t){
  /* "120° 10 - 25 mph" (or an override in kt) into direction and speeds in mph and kt */
  const s2 = String(t || ""), m = s2.match(/(\d{1,3})\s*°?\s+(\d+)\s*(?:-|–|to)\s*(\d+)\s*(mph|kt|kts|knots)?/i);
  if (!m) return { dir:null, lo:null, hi:null };
  const toMph = /kt|knot/i.test(m[4] || "") ? 1/0.868976 : 1;
  return { dir:+m[1], lo:Math.round(+m[2]*toMph), hi:Math.round(+m[3]*toMph) };
}
function csvLMEFWindows(){
  /* the schema is fixed so every file loads into the same table: the standard risk criteria always
     have a column (empty when off), and custom criteria share one "name: level" column */
  const pad = PADS.find(p => p.id === L.pad) || PADS[2], rk = risksOn(), lim = L.liftoff || {};
  const STD = [["shear","risk_upper_level_wind_shear"], ["recovery","risk_booster_recovery_weather"], ["proton","risk_proton_flux"]];
  const head = ["forecast_id","format_version","mission","vehicle","pad_id","pad_name","issued_utc","forecaster","window_index","window_key","window_open_utc","window_close_utc",
    "pov_pct","primary_concern_1","primary_concern_2","primary_concern_3","weather","visibility_mi","temperature_f","relative_humidity_pct",
    "liftoff_wind_height_ft","liftoff_wind_dir_deg","liftoff_wind_min_mph","liftoff_wind_max_mph","liftoff_wind_min_kt","liftoff_wind_max_kt",
    ...[1, 2, 3].flatMap(n => [`cloud${n}_type`, `cloud${n}_coverage`, `cloud${n}_base_ft`, `cloud${n}_tops_ft`]),
    ...STD.map(x => x[1]), "risk_custom",
    "liftoff_constraint_height_ft","liftoff_constraint_kind","liftoff_constraint_operator","liftoff_constraint_value","liftoff_constraint_unit","flight_through_precip_constraint",
    "next_forecast","discussion"];
  const rows = (L.windows || []).map((w, i) => {
    const D = dayData(i), con = String(D.concerns || "").split(/\s*,\s*/).filter(c => c && c !== "None");
    const wd = parseWind(D.wind), clouds = (D.clouds || []).filter(c => c.type && c.type !== "None");
    const vals = {
      forecast_id: forecastId(), format_version: LMEF_CSV_VERSION, mission: L.mission, vehicle: L.vehicle, pad_id: pad.name, pad_name: pad.full,
      issued_utc: isoZ(L.issued || Date.now()), forecaster: (prefs.initials || "").toUpperCase(), window_index: i, window_key: windowKey(i),
      window_open_utc: isoZ(w.a), window_close_utc: isoZ(w.b),
      pov_pct: D.pov == null || D.past ? null : numIn(D.pov), primary_concern_1: con[0], primary_concern_2: con[1], primary_concern_3: con[2],
      weather: D.wx, visibility_mi: numIn(D.vis), temperature_f: numIn(D.temp), relative_humidity_pct: numIn(D.rh),
      liftoff_wind_height_ft: lim.h || 200, liftoff_wind_dir_deg: wd.dir, liftoff_wind_min_mph: wd.lo, liftoff_wind_max_mph: wd.hi,
      liftoff_wind_min_kt: wd.lo == null ? null : Math.round(wd.lo*0.868976), liftoff_wind_max_kt: wd.hi == null ? null : Math.round(wd.hi*0.868976),
      liftoff_constraint_height_ft: lim.h, liftoff_constraint_kind: lim.kind, liftoff_constraint_operator: lim.op, liftoff_constraint_value: lim.v, liftoff_constraint_unit: lim.unit,
      flight_through_precip_constraint: L.ftp ? "true" : "false", next_forecast: L.next || "As Required", discussion: L.discussion,
    };
    [1, 2, 3].forEach(n => { const c = clouds[n - 1] || {}; vals[`cloud${n}_type`] = c.type; vals[`cloud${n}_coverage`] = c.cov; vals[`cloud${n}_base_ft`] = c.base; vals[`cloud${n}_tops_ft`] = c.tops; });
    STD.forEach(([id, c]) => { vals[c] = rk.some(r => r.id === id) ? ((D.risk || {})[id] || "Low") : null; });
    vals.risk_custom = rk.filter(r => !STD.some(x => x[0] === r.id)).map(r => `${r.name}: ${(D.risk || {})[r.id] || "Low"}`).join("; ") || null;
    return head.map(h => csvq(vals[h])).join(",");
  });
  return [head.join(","), ...rows].join("\r\n") + "\r\n";
}
function csvLMEFHourly(){
  /* every rule always has a column (empty when it doesn't apply, e.g. flight through precipitation) */
  const sid = SITES[0].id, OFs = officialFor(sid), o = OFs.o, rules = [...RULES.map(r => r.k), "rftp", "xlw"];
  const head = ["forecast_id","window_index","window_key","valid_start_utc","valid_end_utc","pov_pct", ...rules.map(k => `${slug(CONCERN_NAMES[k])}_pct`),
    "temperature_f","dewpoint_f","precip_prob_pct","lightning_prob_pct","wind_dir_deg","wind_200ft_sust_kt","wind_200ft_peak_kt"];
  const out = [head.join(",")], id = forecastId(), r0 = v => v == null ? null : Math.round(v);
  (L.windows || []).forEach((w, i) => {
    S.rows.forEach((r, ri) => {
      if (!(r.b > w.a && r.a < w.b)) return;
      const vals = { forecast_id:id, window_index:i, window_key:windowKey(i), valid_start_utc:isoZ(Math.max(r.a, w.a)), valid_end_utc:isoZ(Math.min(r.b, w.b)),
        pov_pct: r0(o.rpov && o.rpov[ri]), temperature_f: r0(o.t && o.t[ri]), dewpoint_f: r0(o.td && o.td[ri]), precip_prob_pct: r0(o.pp1 && o.pp1[ri]), lightning_prob_pct: r0(o.lt1 && o.lt1[ri]),
        wind_dir_deg: r0(o.dir && o.dir[ri]), wind_200ft_sust_kt: r0(o.s200 && o.s200[ri]), wind_200ft_peak_kt: r0(o.g200 && o.g200[ri]) };
      rules.forEach(k => vals[`${slug(CONCERN_NAMES[k])}_pct`] = P[k] ? r0(o[k] && o[k][ri]) : null);
      out.push(head.map(h => csvq(vals[h])).join(","));
    });
  });
  return out.join("\r\n") + "\r\n";
}
function csvLMEF(){ return csvLMEFWindows(); }
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
    const D = dayData(i), [pc] = POVC(+D.pov || 0), col = hex(pc), segH = segOn(D) ? 74 : 0, secH = 28 + 92 + segH + chH + 14;
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
/* ---------- legacy-format PDF: the one-page portrait 45 WS LMEF layout ---------- */
const FAQ_URL = "https://45thweathersquadron.nebula.spaceforce.mil/pages/launchForecastSupport.html";
function legacyTimes(a, b){
  const p = lp(a), z = t => new Date(t).toISOString().slice(11, 16).replace(":", "");
  if (b == null) return `${p.d} ${MON[p.mo - 1]} ${p.y} / ${lHM(a)}L (${z(a)}Z)`;
  return `${p.d} ${MON[p.mo - 1]} ${p.y} / ${lHM(a)} – ${lHM(b)}L (${z(a)} – ${z(b)}Z)`;
}
function pdfLMEFLegacy(logo, seal){
  const W = 612, Hp = 792, X0 = 16, X1 = 596, pages = []; let cs = [];
  const f = n => (+n).toFixed(2), rgbf = c => c.map(x => f(x/255)).join(" ");
  const BLACK = [0,0,0], DARK = [171,183,198], LIGHT = [213,219,227];
  const rect = (x, y, w, h, fill) => cs.push(`${rgbf(fill)} rg ${f(x)} ${f(Hp - y - h)} ${f(w)} ${f(h)} re f`);
  const box = (x, y, w, h, lw) => cs.push(`0 0 0 RG ${f(lw || .8)} w ${f(x)} ${f(Hp - y - h)} ${f(w)} ${f(h)} re S`);
  const line = (x1, y1, x2, y2, lw, dash) => cs.push(`0 0 0 RG ${f(lw || .8)} w ${dash ? "[1.5 1.5] 0 d " : ""}${f(x1)} ${f(Hp - y1)} m ${f(x2)} ${f(Hp - y2)} l S${dash ? " [] 0 d" : ""}`);
  const FONT = { r:"F1", b:"F2", i:"F3", bi:"F4" };
  const tw = (s2, size, st) => textW(s2, size, st === "b" || st === "bi");
  const text = (s2, x, y, size, st, align) => { const w = tw(s2, size, st); const tx = align === "c" ? x - w/2 : align === "r" ? x - w : x; cs.push(`BT 0 0 0 rg /${FONT[st || "r"]} ${f(size)} Tf ${f(tx)} ${f(Hp - y)} Td ${pdfStr(s2)} Tj ET`); return w; };
  const vtext = (s2, cx, cy, size) => { const w = tw(s2, size, "b"); cs.push(`BT 0 0 0 rg /F2 ${f(size)} Tf 0 1 -1 0 ${f(cx + size*0.35)} ${f(Hp - cy - w/2)} Tm ${pdfStr(s2)} Tj ET`); };
  const wrap = (s2, first, rest, size, st) => { const out = []; let ln = "", lim = first; for (const w of String(s2 || "").split(/\s+/).filter(Boolean)){ const t = ln ? ln + " " + w : w; if (tw(t, size, st) > lim && ln){ out.push(ln); ln = w; lim = rest; } else ln = t; } if (ln) out.push(ln); return out; };
  const pad = PADS.find(p => p.id === L.pad) || PADS[2], W0 = (L.windows || [])[0] || {};
  const rk = risksOn(), links = [];
  /* header */
  const header = cont => {
    const hh = cont ? 44 : 100; box(X0, 16, X1 - X0, hh);
    const ih = cont ? 34 : 86;
    if (seal) { const sw = ih*seal.rw/seal.rh; cs.push(`q ${f(sw)} 0 0 ${f(ih)} ${f(X0 + 8)} ${f(Hp - 16 - (hh - ih)/2 - ih)} cm /Im2 Do Q`); }
    if (logo) { const lw2 = ih*logo.rw/logo.rh; cs.push(`q ${f(lw2)} 0 0 ${f(ih)} ${f(X1 - 8 - lw2)} ${f(Hp - 16 - (hh - ih)/2 - ih)} cm /Im1 Do Q`); }
    const tx = seal ? X0 + 132 : X0 + 14;
    if (cont){ text(`Launch Mission Execution Forecast: ${L.mission || ""} (continued)`, tx, 43, 13, "b"); return 16 + hh; }
    text("Launch Mission Execution Forecast", tx, 42, 17, "b");
    [["Mission", L.mission || ""], ["Issued", legacyTimes(L.issued || Date.now())], ["Valid", W0.a ? legacyTimes(W0.a, W0.b) : ""]].forEach(([k, v], n) => { text(`${k}:`, tx, 60 + n*15, 11, "b"); text(v, tx + 62, 60 + n*15, 11); });
    return 16 + hh;
  };
  let y = header(false);
  /* forecast discussion */
  { const lab = "Forecast Discussion: ", lw0 = tw(lab, 10.5, "b"), lines = wrap(L.discussion || "", X1 - X0 - 12 - lw0, X1 - X0 - 12, 10.5);
    const h = Math.max(22, 10 + lines.length*13); box(X0, y, X1 - X0, h);
    text(lab, X0 + 6, y + 14, 10.5, "b"); lines.forEach((ln, k) => text(ln, X0 + 6 + (k ? 0 : lw0 + 3), y + 14 + k*13, 10.5)); y += h; }
  /* one section per window */
  const LW = 30, XL = X0 + LW, XR = rk.length ? X1 - 170 : X1, XCL = XL + 186;
  const fit = (s2, maxW, size, st) => { let z = size; while (z > 6 && tw(s2, z, st) > maxW) z -= 0.25; return z; };
  const title = s2 => s2.replace(/\b([a-z])/g, c => c.toUpperCase());
  (L.windows || []).forEach((w, i) => {
    const D = dayData(i), secH = 20 + 34 + 20 + 74, fill = i === 0 ? DARK : LIGHT;
    if (y + secH > Hp - 16 - 72){ pages.push(cs); cs = []; y = header(true); }
    rect(X0, y, LW, secH, fill); box(X0, y, LW, secH); vtext(i === 0 ? "Launch Day" : title(winLabel(i)), X0 + LW/2, y + secH/2, 15);
    /* PoV header */
    rect(XL, y, X1 - XL, 20, fill); box(XL, y, X1 - XL, 20);
    const t1 = "Probability of Violating Weather Constraints", w1 = tw(t1, 11.5, "b"); text(t1, (XL + X1)/2, y + 14.5, 11.5, "b", "c"); if (i === 0) text("1", (XL + X1)/2 + w1/2 + 3, y + 9.5, 7, "b");
    y += 20;
    box(XL, y, 62, 34); box(XL + 62, y, X1 - XL - 62, 34);
    text(D.past ? "-" : `${D.pov ?? "-"}%`, XL + 31, y + 23, 18, "b", "c");
    const pcw = text("Primary Concerns:", XL + 70, y + 21, 10.5, "b");
    const ctext = String(D.concerns || "None").split(/\s*,\s*/).join(", ");
    text(ctext, XL + 70 + pcw + 6, y + 21, fit(ctext, X1 - XL - 84 - pcw, 10.5, "r")); y += 34;
    /* sub-headers */
    rect(XL, y, X1 - XL, 20, fill); box(XL, y, XR - XL, 20); text("Weather Conditions", (XL + XR)/2, y + 14.5, 11.5, "b", "c");
    if (rk.length){ box(XR, y, X1 - XR, 20); const t2 = "Additional Risk Criteria", w2 = tw(t2, 11.5, "b"); text(t2, (XR + X1)/2, y + 14.5, 11.5, "b", "c"); if (i === 0) text("2", (XR + X1)/2 + w2/2 + 3, y + 9.5, 7, "b"); }
    y += 20;
    const bh = 74; box(XL, y, XR - XL, bh); if (rk.length) box(XR, y, X1 - XR, bh);
    line(XCL, y + 3, XCL, y + bh - 3, .6, true);
    const lift = `Liftoff Winds (${(L.liftoff && L.liftoff.h) || 200}’)`;
    [["Weather/Visibility", `${D.wx || "-"} / ${D.vis || "-"}`], ["Temp/Humidity", `${D.temp || "-"} / ${D.rh || "-"}`], [lift, D.wind || "-"]].forEach(([k, v], n) => {
      const yy = y + 16 + n*24; text(k + ":", XL + 6, yy, 9.5, "b"); text(v, XL + 102, yy, fit(v, XCL - XL - 108, 9.5, "r"));
    });
    /* clouds */
    text("Clouds", (XCL + XR)/2, y + 11, 9.5, "b", "c");
    const cx = [XCL + 6, XCL + 66, XCL + 118, XCL + 158];
    ["Type", "Coverage", "Base (ft)", "Tops (ft)"].forEach((h, k) => text(h, cx[k], y + 22, 7.5));
    (D.clouds || []).slice(0, 3).forEach((c, r) => { const yy = y + 37 + r*13; [c.type || "", c.cov || "", c.base ? Number(c.base).toLocaleString("en-US") : "", c.tops ? Number(c.tops).toLocaleString("en-US") : ""].forEach((v, k) => text(String(v), cx[k], yy, fit(String(v), (cx[k + 1] || XR - 2) - cx[k] - 4, 9.5, "r"))); });
    /* additional risk criteria */
    const rvx = Math.min(X1 - 44, XR + 10 + Math.max(0, ...rk.slice(0, 3).map(r => tw(r.name + ":", 9.5, "b"))));
    rk.slice(0, 3).forEach((r, n) => { const yy = y + 16 + n*24, nm = r.name + ":"; text(nm, XR + 6, yy, fit(nm, rvx - XR - 12, 9.5, "b"), "b"); text((D.risk || {})[r.id] || "Low", rvx, yy, 9.5); });
    y += bh;
  });
  /* notes and next forecast */
  if (y + 72 > Hp - 16){ pages.push(cs); cs = []; y = header(true); }
  const nh = 48; box(X0, y, LW, nh); box(XL, y, X1 - XL, nh); vtext("Notes", X0 + LW/2, y + nh/2, 13);
  text("1.", XL + 10, y + 12, 7.5, "i"); text("The Probability of Violation (PoV) is the chance of a local safety or customer constraint violation occurring any random time during the launch window.", XL + 22, y + 12, 7.5, "i");
  if (rk.length){ text("2.", XL + 10, y + 22, 7.5, "i"); text("Additional Risk Criteria, which are not included in the PoV, are mission-specific constraints that may not include all phenomena within each risk factor.", XL + 22, y + 22, 7.5, "i"); }
  { const a = "See Launch FAQ ", b = " for more information", wa = tw(a, 7.5, "bi"), wu = tw(FAQ_URL, 7.5, "r"), wb = tw(b, 7.5, "bi"), x0 = (XL + X1)/2 - (wa + wu + wb)/2, yy = y + 33;
    text(a, x0, yy, 7.5, "bi"); cs.push(`BT 0.02 0.27 0.8 rg /F1 7.5 Tf ${f(x0 + wa)} ${f(Hp - yy)} Td ${pdfStr(FAQ_URL)} Tj ET`); line(x0 + wa, yy + 1, x0 + wa + wu, yy + 1, .4); text(b, x0 + wa + wu, yy, 7.5, "bi");
    links.push({ page: pages.length, x: x0 + wa, y: yy - 7, w: wu, h: 9, url: FAQ_URL }); }
  y += nh;
  box(X0, y, 178, 22); box(X0 + 178, y, X1 - X0 - 178, 22);
  text("Next Forecast Will Be Issued", X0 + 6, y + 15, 10.5, "b"); text(L.next || "As Required", X0 + 184, y + 15, 10.5);
  pages.push(cs);
  return pdfAssemble(pages.map(p => p.join("\n")), logo, W, Hp, { image2: seal || null, links });
}
/* optional seal for the left of the legacy header, kept on this computer */
async function loadSeal(){
  try { const d = localStorage.getItem("lmef:seal"); if (!d) return null; const bin = atob(d.split(",")[1]); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return await decodeImage(u, d.slice(5, d.indexOf(";"))); } catch (e) { return null; }
}
function htmlLMEF(logo){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LMEF ${hesc(L.mission || "")}</title><link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&family=Barlow+Condensed:wght@600;700&display=swap" rel="stylesheet"><style>body{margin:0;padding:24px;background:#EEF2F4}${LM_CSS}@media print{body{background:#fff;padding:0}.lm{box-shadow:none}}</style></head><body>${productHTML(logo)}</body></html>`;
}


/* ---------- setup and product panels ---------- */
const SETUP_HTML = `
<section class="panel lmsetup" id="lmSetup" aria-label="Mission setup">
  <div class="lmcols">
    <div>
      <h3>Mission</h3>
      <div class="edgrid">
        <label class="wide">Upcoming Space Coast launch <select id="lmMission"><option>Loading</option></select></label>
        <p class="wide mut schline">Official schedule: <span class="btn ghost fileb sm">Upload CSV<input type="file" id="lmSchFile" accept=".csv,text/csv"></span> <button type="button" class="lnk" id="lmSchTpl">CSV template</button> <button type="button" class="lnk" id="lmSchClear" hidden>clear</button> <span id="lmSchNote">launches you upload appear first in the list, kept on this computer only</span></p>
        <label class="wide">Mission name <input id="lmName" autocomplete="off"></label>
        <label>Vehicle <input id="lmVeh" list="lmVehList" autocomplete="off"></label>
        <label>Pad <select id="lmPad"></select></label>
        <label class="wide">Issued <input id="lmIss" type="datetime-local"></label>
      </div>
      <h3>Windows <small>local time, opens and closes</small></h3>
      <div id="lmWins" class="wins"></div>
    </div>
    <div>
      <h3>Constraints <small>shown on the product as "Liftoff Winds"</small></h3>
      <div class="edgrid lift" id="lmLift"></div>
      <label class="chk"><input type="checkbox" id="lmFtp"> This mission has a Flight Through Precipitation constraint</label>
      <h3>Additional risk criteria <small>tick to show on the product</small></h3>
      <div id="lmRisks" class="risks"></div>
    </div>
    <div>
      <h3>Recovery weather <small>sites and limits for Booster Recovery Weather</small></h3>
      <div id="lmRec" class="recs"></div>
      <p class="mut lmnote">The table and graphs below hold the hourly forecast for every window: one row per NASA-STD-4010B lightning launch commit criterion, the liftoff wind constraint, and the hourly probability of violation built from them. Edit any hour; the product updates as you go.</p>
    </div>
  </div>
  <datalist id="lmVehList"><option value="Falcon 9"><option value="Falcon Heavy"><option value="Vulcan"><option value="Atlas V"><option value="New Glenn"><option value="SLS"><option value="Starship"></datalist>
</section>`;
const PRODUCT_HTML = `
<section class="panel lmprod" id="lmProduct" aria-label="LMEF product">
  <div class="lmprodhead"><h2>LMEF product</h2><span class="mut">Built from the forecast above. Type in a field to override it for the product; ↺ goes back to the forecast.</span>
    <div class="actions"><button class="btn" id="lmCsv">CSV</button><button class="btn" id="lmXlsx">Excel</button><button class="btn" id="lmHtml">HTML</button><label class="pdffmt">PDF format <select id="lmPdfFmt"><option value="legacy">Legacy</option><option value="modern">New</option></select></label><button class="btn primary" id="lmPdf">Download PDF</button></div>
    <p class="mut sealrow" id="lmSealRow">Legacy header seal: <span id="lmSealState">none</span> <span class="btn ghost fileb sm">Choose image<input type="file" id="lmSeal" accept="image/png,image/jpeg"></span> <button type="button" class="lnk" id="lmSealClear" hidden>remove</button></p></div>
  <div class="lmprodgrid">
    <div class="lmed">
      <h3>Forecast discussion <button type="button" class="lnk" id="lmDiscReset">redraft from the forecast</button></h3>
      <textarea id="lmDisc" rows="7"></textarea>
      <div id="lmDays"></div>
      <h3>Footer</h3>
      <div class="edgrid"><label class="wide">Next forecast will be issued <input id="lmNext"></label></div>
      <datalist id="lmConcernList"></datalist>
    </div>
    <div class="lmprev"><div id="lmPreview"></div></div>
  </div>
</section>`;
function mountPanels(){
  const main = document.querySelector("main");
  main.insertAdjacentHTML("afterbegin", SETUP_HTML);
  const tablePanel = document.getElementById("matrix").closest("section") || main.lastElementChild;
  tablePanel.insertAdjacentHTML("afterend", PRODUCT_HTML);
  /* this page has its own outputs */
  ["publish","briefBtn"].forEach(id => { const el = document.getElementById(id); if (el) el.hidden = true; });
  document.querySelectorAll(".plan-only").forEach(x => x.hidden = true);
  const t = document.getElementById("pageTitle"); if (t) t.textContent = "Launch forecast (LMEF)";
  document.title = "Launch Mission Execution Forecast | 45th Weather Squadron";
  document.querySelectorAll('.pagenav a[data-page="lmef"]').forEach(a => a.setAttribute("aria-current", "page"));
}
function lmRenderStatus(){ /* the editor's status line covers guidance loading */ }
/* launches from the uploaded official schedule, ahead of the public list */
function schedLaunches(){
  return loadSched().filter(x => x.type === "launch" && x.b > Date.now() - 6*H).map(x => {
    const pad = PADS.find(p => normLoc(p.name) === normLoc(x.location) || p.match.test(x.location || ""));
    return { id:x.id, name:x.name, vehicle:x.vehicle || x.provider || "", pad: pad ? pad.id : null, padName:x.location || "", net:x.a, w0:x.a, w1:x.b, backup:x.backup, limit:x.limit, official:true, status:"Official" };
  });
}
function allMissions(){ return [...(SX.official || []), ...(SX.launches || [])]; }
function renderMissions(){
  SX.official = schedLaunches();
  const off = SX.official;
  if ($("lmSchClear")) $("lmSchClear").hidden = !loadSched().some(x => x.type === "launch");
  const optOf = x => `<option value="${hesc(x.id)}" ${x.id === L.missionId ? "selected" : ""}>${hesc(lDate(x.net))} ${lHM(x.net)}L · ${x.vehicle ? hesc(x.vehicle) + " · " : ""}${hesc(x.name)}${x.pad ? "" : " (pad not listed)"}</option>`;
  if (off.length){
    $("lmMission").innerHTML = `<option value="">Custom mission (type the details)</option><optgroup label="Official schedule (uploaded)">${off.map(optOf).join("")}</optgroup>` + (SX.launches.length ? `<optgroup label="Public launch list">${SX.launches.map(optOf).join("")}</optgroup>` : "");
    return;
  }
  if (!SX.launches.length){ $("lmMission").innerHTML = `<option value="">No launch list yet. Run the planning MOS workflow, or type the mission below</option>`; return; }
  $("lmMission").innerHTML = `<option value="">Custom mission (type the details)</option>` + SX.launches.map(x => `<option value="${hesc(x.id)}" ${x.id === L.missionId ? "selected" : ""}>${hesc(lDate(x.net))} ${lHM(x.net)}L · ${hesc(x.vehicle)} · ${hesc(x.name)}${x.pad ? "" : " (pad not listed)"}</option>`).join("");
}
const opt = (list, v) => list.map(x => `<option ${x === v ? "selected" : ""}>${x}</option>`).join("");
function renderSetup(){
  const ae = document.activeElement, set = (id, v) => { if ($(id) !== ae) $(id).value = v ?? ""; };
  set("lmName", L.mission); set("lmVeh", L.vehicle); $("lmPad").value = L.pad; set("lmIss", toInput(L.issued || Date.now()));
  if (!$("lmLift").contains(ae)) $("lmLift").innerHTML = `<label>Height <span class="u"><input data-l="h" type="number" min="10" max="600" value="${L.liftoff.h}"> ft</span></label><label>Wind <select data-l="kind">${[["peak","Peak"],["sust","Sustained"]].map(([v, l]) => `<option value="${v}" ${L.liftoff.kind === v ? "selected" : ""}>${l}</option>`).join("")}</select></label><label>Limit <span class="u"><select data-l="op"><option value=">" ${L.liftoff.op === ">" ? "selected" : ""}>&gt;</option><option value=">=" ${L.liftoff.op === ">=" ? "selected" : ""}>≥</option></select><input data-l="v" type="number" min="0" value="${L.liftoff.v}"></span></label><label>Units <select data-l="unit">${Object.keys(LIFT_UNITS).map(u => `<option ${u === L.liftoff.unit ? "selected" : ""}>${u}</option>`).join("")}</select></label>`;
  $("lmFtp").checked = !!L.ftp;
  if (!$("lmWins").contains(ae)) $("lmWins").innerHTML = (L.windows || []).map((w, i) => `<div class="wrow" data-w="${i}"><span>${winLabel(i)}</span><input type="datetime-local" data-wa="a" value="${toInput(w.a)}"><input type="datetime-local" data-wa="b" value="${toInput(w.b)}">${i ? `<button type="button" class="x" data-delw="${i}" aria-label="Remove ${winLabel(i)}">×</button>` : "<i></i>"}</div>`).join("") + `<button type="button" class="lnk" id="lmAddWin">+ add delay day</button>`;
  if (!$("lmRisks").contains(ae)) $("lmRisks").innerHTML = L.risks.map((r, i) => { const b = BUILTIN_RISKS.find(x => x.id === r.id); return `<div class="rrow" data-r="${i}"><input type="checkbox" data-ron ${r.on ? "checked" : ""} aria-label="Show ${hesc(r.name)}">${b ? `<span>${hesc(r.name)}<small>auto from ${b.auto}</small></span><i></i>` : `<input data-rname value="${hesc(r.name)}" placeholder="Criterion name"><button type="button" class="x" data-delr="${i}" aria-label="Remove">×</button>`}</div>`; }).join("") + `<button type="button" class="lnk" id="lmAddRisk">+ custom criterion</button>`;
  if (!$("lmRec").contains(ae)) $("lmRec").innerHTML = ((L.recovery || []).length ? `<div class="recrow hd"><span>Site</span><span>Latitude</span><span>Longitude</span><span>Max wind</span><span>Max seas</span><i></i></div>` : `<p class="mut">Add the booster or fairing recovery site to evaluate its winds and seas against your limits.</p>`) + (L.recovery || []).map((r, i) => `<div class="recrow" data-k="${i}"><input data-rc="name" value="${hesc(r.name || "")}" placeholder="Site (e.g. ASDS)"><input data-rc="lat" inputmode="decimal" value="${r.lat ?? ""}" placeholder="Lat"><input data-rc="lon" inputmode="decimal" value="${r.lon ?? ""}" placeholder="Lon"><span class="u"><input data-rc="windKt" type="number" value="${r.windKt ?? ""}" placeholder="Wind"> kt</span><span class="u"><input data-rc="waveFt" type="number" step="0.5" value="${r.waveFt ?? ""}" placeholder="Seas"> ft</span><button type="button" class="x" data-delrec="${i}" aria-label="Remove site">×</button></div>`).join("") + `<button type="button" class="lnk" id="lmAddRec">+ recovery site</button>`;
}
function renderProductEditor(){
  const ae = document.activeElement, box = $("lmDays");
  if ($("lmDisc") !== ae){ if (!L.discussionEdited) L.discussion = draftDiscussion(); $("lmDisc").value = L.discussion || ""; }
  if ($("lmNext") !== ae) $("lmNext").value = L.next || "";
  if (box.contains(ae)) return;
  box.innerHTML = (L.windows || []).map((w, i) => {
    const d = derive(i), ov = (L.days[i] && L.days[i].ov) || {}, D = dayData(i);
    if (d.pending) return `<details class="dayed" open><summary>${winLabel(i).replace(/^./, c => c.toUpperCase())}</summary><p class="mut">Waiting for guidance.</p></details>`;
    if (d.past) return `<details class="dayed" open><summary>${winLabel(i).replace(/^./, c => c.toUpperCase())}</summary><p class="warnline">This window (${winText(w.a, w.b)}) has already passed, so there's no forecast for it. Pick an upcoming launch or move the window in the setup above.</p>${fields(i, d, ov)}</details>`;
    if (d.outOfRange) return `<details class="dayed" open><summary>${winLabel(i).replace(/^./, c => c.toUpperCase())}</summary><p class="mut">This window is beyond the guidance (about 8 days). Fill in the product fields by hand.</p>${fields(i, d, ov)}</details>`;
    const top = (d.ranks || []).filter(x => x[1] >= 1).slice(0, 5).map(([k, v]) => `${CONCERN_NAMES[k]} ${Math.round(v)}%`).join(", ");
    return `<details class="dayed" open><summary>${winLabel(i).replace(/^./, c => c.toUpperCase())} <span class="mut">${winText(w.a, w.b)}</span></summary>${fields(i, d, ov)}
      ${d.seg ? `<label class="chk"><input type="checkbox" data-segon="${i}" ${D.showSeg ? "checked" : ""}> Show PoV through the window on the product</label>` : ""}
      <p class="mut gd">From the forecast: window PoV ${d.pov ?? "–"}% (average of the hourly PoV row). Rule averages: ${top || "all near zero"}.${Object.keys(d.why || {}).length ? " " + Object.entries(d.why).map(([k, v]) => `${(L.risks.find(r => r.id === k) || {}).name || k}: ${v}`).join(". ") + "." : ""}</p></details>`;
  }).join("");
}
/* primary concerns: pick from the rules and constraints in this forecast (or add another) */
function concernOptions(){ return Object.keys(CONCERN_NAMES).filter(k => P[k]).map(k => CONCERN_NAMES[k]); }
const splitC = v => String(v || "").split(/\s*,\s*/).filter(x => x && x !== "None");
function concernPicker(i, d, ov){
  const sel = splitC(ov.concerns !== undefined ? ov.concerns : d.concerns);
  const opts = [...new Set([...concernOptions(), ...sel])];
  return `<div class="wide cpick ${ov.concerns !== undefined ? "ov" : ""}"><span>Primary concerns ${ov.concerns !== undefined ? `<button type="button" class="rs" data-rs="concerns" title="Back to the forecast (${hesc(d.concerns || "None")})">↺</button>` : `<small>from the forecast; click to change</small>`}</span>
    <div class="cchips">${opts.map(c => `<button type="button" class="cc ${sel.includes(c) ? "on" : ""}" data-cc="${hesc(c)}" aria-pressed="${sel.includes(c)}">${hesc(c)}</button>`).join("")}<button type="button" class="cc none ${sel.length ? "" : "on"}" data-cc="None" aria-pressed="${!sel.length}">None</button></div>
    <input class="cother" data-cother placeholder="Other concern, press Enter" list="lmConcernList"></div>`;
}
function fields(i, d, ov){
  const fld = (f, label, cls) => `<label class="${cls || ""} ${ov[f] !== undefined ? "ov" : ""}">${label}<span class="u"><input data-f="${f}" ${f === "concerns" ? 'list="lmConcernList"' : ""} value="${hesc(ov[f] !== undefined ? ov[f] : (d[f] ?? ""))}">${ov[f] !== undefined ? `<button type="button" class="rs" data-rs="${f}" title="Back to the forecast value (${hesc(d[f] ?? "")})">↺</button>` : ""}</span></label>`;
  const D = dayData(i);
  return `<div class="edgrid" data-day="${i}">
    ${fld("pov", "PoV %", "pv")}${concernPicker(i, d, ov)}
    ${fld("wx", "Weather")}${fld("vis", "Visibility")}${fld("temp", "Temperature")}${fld("rh", "Humidity")}${fld("wind", "Liftoff winds (200 ft)", "wide")}
    <div class="wide clouds"><span>Clouds ${ov.clouds ? `<button type="button" class="rs" data-rs="clouds" title="Back to the forecast layers">↺</button>` : ""}</span>${(D.clouds || []).map((c, k) => `<div class="crow" data-i="${k}"><input data-c="type" value="${hesc(c.type || "")}" placeholder="Type"><select data-c="cov">${opt(["","Few","Scattered","Broken","Overcast"], c.cov || "")}</select><input data-c="base" type="number" step="500" value="${c.base ?? ""}" placeholder="Base"><input data-c="tops" type="number" step="500" value="${c.tops ?? ""}" placeholder="Tops"><button type="button" class="x" data-delc="${k}" aria-label="Remove layer">×</button></div>`).join("")}<button type="button" class="lnk" data-addc="1">+ cloud layer</button></div>
    ${risksOn().map(r => `<label class="${ov.risk && ov.risk[r.id] ? "ov" : ""}">${hesc(r.name)} <select data-risk="${r.id}">${opt(RISK, D.risk[r.id] || "Low")}</select></label>`).join("")}
  </div>`;
}
function renderPreview(){ $("lmPreview").innerHTML = productHTML(null); }
let prodT = null;
function refreshProduct(){ clearTimeout(prodT); prodT = setTimeout(() => { renderSetup(); renderProductEditor(); renderPreview(); }, 120); }
/* settings that change the editor itself (pad, windows, constraints) */
function reconfigure(full){
  saveL();
  EDITOR_HOOKS.config(); rebuildViews();
  prefs.site = SITES[0].id; savePrefs();
  if (!P[prefs.param] && !VIEWS[prefs.param]) prefs.param = "rpov";
  if (full || SX.lastPad !== L.pad){ SX.lastPad = L.pad; loadAll(); loadExtras(); }
  else rebuildGuidance();
  refreshProduct();
}
function pickMission(id){
  const x = allMissions().find(l => l.id === id); L.missionId = id || "";
  if (x){
    L.mission = x.name; L.vehicle = x.vehicle; if (x.pad) L.pad = x.pad;
    const b = Math.max(x.w1, x.w0);
    L.windows = [{ a:x.w0, b }, x.backup ? { a:x.backup.a, b:Math.max(x.backup.a, x.backup.b) } : { a:x.w0 + 24*H, b:b + 24*H }];
    if (x.limit){ L.liftoff = Object.assign(L.liftoff || {}, { v:x.limit, unit:"kt" }); }
    if (x.official && !x.pad) setTimeout(() => toast(`${x.name}: the schedule gives no pad, so check the pad below`), 1500);
    /* the liftoff wind constraint stays as the forecaster set it */
    L.days = []; L.discussionEdited = false;
  }
  reconfigure(false);
}
function ovOf(i){ L.days[i] = L.days[i] || {}; L.days[i].ov = L.days[i].ov || {}; return L.days[i].ov; }
function bindLM(){
  $("lmMission").onchange = e => pickMission(e.target.value);
  $("lmName").addEventListener("input", e => { L.mission = e.target.value; saveL(); renderPreview(); });
  $("lmVeh").addEventListener("input", e => { L.vehicle = e.target.value; saveL(); renderPreview(); });
  $("lmPad").addEventListener("change", e => { L.pad = e.target.value; reconfigure(true); });
  $("lmIss").addEventListener("change", e => { L.issued = fromInput(e.target.value); saveL(); renderPreview(); });
  $("lmNext").addEventListener("input", e => { L.next = e.target.value; saveL(); renderPreview(); });
  $("lmDisc").addEventListener("input", e => { L.discussion = e.target.value; L.discussionEdited = true; saveL(); renderPreview(); });
  $("lmDiscReset").onclick = () => { L.discussionEdited = false; L.discussion = draftDiscussion(); saveL(); $("lmDisc").value = L.discussion; renderPreview(); };
  $("lmLift").addEventListener("change", e => { const k = e.target.dataset.l; if (!k) return; L.liftoff[k] = e.target.type === "number" ? +e.target.value : e.target.value; reconfigure(false); });
  $("lmFtp").onchange = e => { L.ftp = e.target.checked; reconfigure(false); };
  $("lmWins").addEventListener("change", e => { const row = e.target.closest("[data-w]"); if (!row || !e.target.dataset.wa) return; const i = +row.dataset.w, v = fromInput(e.target.value); if (v == null) return; L.windows[i][e.target.dataset.wa] = v; if (i === 0){ const dur = L.windows[0].b - L.windows[0].a; L.windows.forEach((w, k) => { if (k && !w.custom){ w.a = L.windows[0].a + k*24*H; w.b = w.a + dur; } }); } else L.windows[i].custom = true; reconfigure(false); });
  $("lmWins").addEventListener("click", e => {
    if (e.target.tagName === "BUTTON") e.target.blur();
    if (e.target.id === "lmAddWin"){ const last = L.windows[L.windows.length - 1]; L.windows.push({ a:last.a + 24*H, b:last.b + 24*H }); reconfigure(false); }
    if (e.target.dataset.delw){ const i = +e.target.dataset.delw; L.windows.splice(i, 1); L.days.splice(i, 1); reconfigure(false); }
  });
  $("lmRisks").addEventListener("change", e => { const row = e.target.closest("[data-r]"); if (!row) return; const r = L.risks[+row.dataset.r]; if (e.target.hasAttribute("data-ron")) r.on = e.target.checked; if (e.target.hasAttribute("data-rname")) r.name = e.target.value; saveL(); refreshProduct(); });
  $("lmRisks").addEventListener("input", e => { if (!e.target.hasAttribute("data-rname")) return; L.risks[+e.target.closest("[data-r]").dataset.r].name = e.target.value; saveL(); renderPreview(); });
  $("lmRisks").addEventListener("click", e => {
    if (e.target.tagName === "BUTTON") e.target.blur();
    if (e.target.id === "lmAddRisk"){ L.risks.push({ id:"c" + Date.now().toString(36), name:"", on:true }); saveL(); renderSetup(); renderProductEditor(); const ins = $("lmRisks").querySelectorAll("[data-rname]"); if (ins.length) ins[ins.length - 1].focus(); }
    if (e.target.dataset.delr){ L.risks.splice(+e.target.dataset.delr, 1); saveL(); refreshProduct(); }
  });
  $("lmRec").addEventListener("change", e => { const row = e.target.closest("[data-k]"); if (!row) return; const r = L.recovery[+row.dataset.k], k = e.target.dataset.rc; r[k] = ["lat","lon","windKt","waveFt"].includes(k) ? (e.target.value === "" ? null : +e.target.value) : e.target.value; saveL(); if (k === "lat" || k === "lon") loadRecovery(); else refreshProduct(); });
  $("lmRec").addEventListener("click", e => {
    if (e.target.tagName === "BUTTON") e.target.blur();
    if (e.target.id === "lmAddRec"){ L.recovery.push({ id:"r" + Date.now().toString(36), name:"ASDS", lat:null, lon:null, windKt:25, waveFt:8 }); saveL(); renderSetup(); }
    if (e.target.dataset.delrec){ L.recovery.splice(+e.target.dataset.delrec, 1); saveL(); renderSetup(); loadRecovery(); }
  });
  /* product overrides */
  const box = $("lmDays");
  const upd = e => {
    const grid = e.target.closest("[data-day]"), t = e.target;
    if (t.dataset.segon != null){ const i = +t.dataset.segon; L.days[i] = L.days[i] || {}; L.days[i].showSeg = t.checked; saveL(); renderPreview(); return; }
    if (!grid || (t.hasAttribute && t.hasAttribute("data-cother"))) return; const i = +grid.dataset.day, ov = ovOf(i);
    if (t.dataset.f) ov[t.dataset.f] = t.dataset.f === "pov" ? (t.value === "" ? undefined : Math.max(0, Math.min(100, +t.value))) : t.value;
    if (t.dataset.risk){ ov.risk = ov.risk || {}; ov.risk[t.dataset.risk] = t.value; }
    if (t.dataset.c){ const k = +t.closest("[data-i]").dataset.i; if (!ov.clouds) ov.clouds = (dayData(i).clouds || []).map(c => ({ ...c })); ov.clouds[k] = ov.clouds[k] || {}; ov.clouds[k][t.dataset.c] = t.type === "number" ? (t.value === "" ? null : +t.value) : t.value; }
    saveL(); renderPreview();
  };
  box.addEventListener("keydown", e => {
    if (!e.target.hasAttribute || !e.target.hasAttribute("data-cother") || e.key !== "Enter") return;
    e.preventDefault(); const v = e.target.value.trim(); if (!v) return;
    const i = +e.target.closest(".dayed").querySelector("[data-day]").dataset.day, ov = ovOf(i);
    const sel = splitC(ov.concerns !== undefined ? ov.concerns : dayData(i).concerns); if (!sel.includes(v)) sel.push(v);
    ov.concerns = sel.join(", "); saveL(); e.target.blur(); box.innerHTML = ""; refreshProduct();
  });
  box.addEventListener("input", upd); box.addEventListener("change", e => { upd(e); if (e.target.dataset.f || e.target.dataset.risk) { e.target.blur && null; } });
  box.addEventListener("click", e => {
    if (e.target.tagName === "BUTTON") e.target.blur();
    const grid = e.target.closest(".dayed"); if (!grid) return; const g2 = grid.querySelector("[data-day]"); if (!g2) return; const i = +g2.dataset.day, ov = ovOf(i);
    if (e.target.dataset.rs){ delete ov[e.target.dataset.rs]; saveL(); box.innerHTML = ""; refreshProduct(); }
    if (e.target.dataset.cc){
      const c = e.target.dataset.cc; let sel = splitC(ov.concerns !== undefined ? ov.concerns : dayData(i).concerns);
      if (c === "None") sel = []; else sel = sel.includes(c) ? sel.filter(x => x !== c) : [...sel, c];
      ov.concerns = sel.length ? sel.join(", ") : "None"; saveL(); box.innerHTML = ""; refreshProduct();
    }
    if (e.target.dataset.addc){ if (!ov.clouds) ov.clouds = (dayData(i).clouds || []).filter(c => c.type !== "None").map(c => ({ ...c })); ov.clouds.push({ type:"", cov:"", base:null, tops:null }); saveL(); box.innerHTML = ""; refreshProduct(); }
    if (e.target.dataset.delc != null){ if (!ov.clouds) ov.clouds = (dayData(i).clouds || []).map(c => ({ ...c })); ov.clouds.splice(+e.target.dataset.delc, 1); saveL(); box.innerHTML = ""; refreshProduct(); }
  });
  const stamp = () => { const p = lp(Date.now()); return `${p.y}${lpad(p.mo)}${lpad(p.d)}_${lpad(p.h)}${lpad(p.mi)}`; };
  const base = () => `LMEF_${(L.mission || "Mission").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}_${stamp()}`;
  $("lmSchFile").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) schedUpload(f, () => { renderMissions(); const n = SX.official.find(x => x.w1 > Date.now()); if (n && !String(L.missionId || "").startsWith("sched:")){ $("lmMission").value = n.id; pickMission(n.id); } }, "launch"); };
  $("lmSchTpl").onclick = () => download(new Blob([SCHED_TEMPLATE], { type:"text/csv" }), "Official_Schedule_template.csv");
  $("lmSchClear").onclick = () => { if (!confirm("Remove the official launches stored on this computer?")) return; saveSched(loadSched().filter(x => x.type !== "launch")); renderMissions(); };
  $("lmPdfFmt").value = L.pdfFmt || "legacy";
  $("lmPdfFmt").onchange = e => { L.pdfFmt = e.target.value; saveL(); showSealRow(); };
  $("lmPdf").onclick = async () => { const logo = await loadLogo(); download((L.pdfFmt || "legacy") === "legacy" ? pdfLMEFLegacy(logo, await loadSeal()) : pdfLMEF(logo), base() + ".pdf"); };
  const showSealRow = () => { $("lmSealRow").hidden = (L.pdfFmt || "legacy") !== "legacy"; const has = !!localStorage.getItem("lmef:seal"); $("lmSealState").textContent = has ? "set (on the left of the header)" : "none"; $("lmSealClear").hidden = !has; };
  $("lmSeal").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    if (f.size > 1.5e6){ toast("Use an image under 1.5 MB"); return; }
    const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
    try { localStorage.setItem("lmef:seal", url); toast("Seal saved on this computer for the legacy PDF"); } catch (err) { toast("Couldn't save the image (browser storage is full)"); }
    showSealRow();
  };
  $("lmSealClear").onclick = () => { localStorage.removeItem("lmef:seal"); showSealRow(); };
  showSealRow();
  $("lmHtml").onclick = async () => download(new Blob([htmlLMEF(await loadLogo())], { type:"text/html" }), base() + ".html");
  $("lmXlsx").onclick = async () => download(xlsxLMEF(await loadLogo()), base() + ".xlsx");
  $("lmCsv").onclick = () => {
    download(new Blob([csvLMEFWindows()], { type:"text/csv;charset=utf-8" }), base() + "_windows.csv");
    setTimeout(() => download(new Blob([csvLMEFHourly()], { type:"text/csv;charset=utf-8" }), base() + "_hourly.csv"), 400);
    toast("Downloaded two CSV tables: windows and hourly, joined by forecast_id");
  };
  $("lmPad").innerHTML = PADS.map(p => `<option value="${p.id}">${p.name} (${p.full})</option>`).join("");
  $("lmConcernList").innerHTML = [...Object.values(CONCERN_NAMES), "None"].map(c => `<option value="${c}">`).join("");
}
async function initLM(){
  const st = document.createElement("style"); st.textContent = LM_CSS; document.head.appendChild(st);
  mountPanels(); bindLM();
  SX.lastPad = L.pad;
  EDITOR_HOOKS.rendered = refreshProduct;
  /* open on the PoV graph the first time */
  if ((!P[prefs.param] && !VIEWS[prefs.param]) || !L.chartInit){ prefs.param = "rpov"; L.chartInit = true; saveL(); savePrefs(); renderAll(); }
  const sitesNav = document.getElementById("sites"); if (sitesNav) sitesNav.hidden = true;
  refreshProduct(); loadExtras();
  SX.launches = DEMO ? demoLaunches() : await fetchLaunches().catch(() => []);
  renderMissions();
  /* first visit, or the saved launch has already gone: start from the next launch */
  const stale = !(L.windows || []).some(w => w.b > Date.now());
  if ((!L.missionId && !L.mission) || stale){
    const next = allMissions().find(x => x.w1 > Date.now());
    if (next){ if (stale && L.mission) toast(`The saved windows had passed, so this opened on the next launch: ${next.name}`); $("lmMission").value = next.id; pickMission(next.id); }
    else if (stale){ const t = Math.ceil(Date.now()/H)*H + 26*H; L.windows = [{ a:t, b:t + 4*H }, { a:t + 24*H, b:t + 28*H }]; L.days = []; L.missionId = ""; toast("The saved windows had passed; set the mission and windows for the next launch"); reconfigure(false); }
  }
}
function demoLaunches(){ const t = Math.ceil(Date.now()/H)*H + 20*H; return [
  { id:"d1", name:"Starlink Group 10-11", vehicle:"Falcon 9", pad:"slc40", net:t, w0:t, w1:t + 4*H },
  { id:"d2", name:"USSF-106", vehicle:"Vulcan", pad:"slc41", net:t + 50*H, w0:t + 50*H, w1:t + 52*H },
  { id:"d3", name:"Crew-12", vehicle:"Falcon 9", pad:"lc39a", net:t + 100*H, w0:t + 100*H, w1:t + 100*H } ]; }
const lmFit = (t, maxW, size, bold) => { let z = size; while (z > 5 && textW(t, z, bold) > maxW) z -= 0.25; return z; };
initLM();
