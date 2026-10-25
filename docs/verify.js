"use strict";
/* ============================================================
   Verification dashboard
   Guidance scores come from the verification workflow (data/verif/summary.json);
   official forecasts are the published CSVs loaded here and scored in this browser.
   ============================================================ */
const $ = id => document.getElementById(id);
const VB = (typeof DATA_BASE !== "undefined" ? DATA_BASE : "") + "data/verif/";
const POINT_OF = { SLF:"ksc-inland", "LC-39B":"ksc-pads", KXMR:"cape-inland", "SLC-37":"cape-pad37", KCOF:"patrick" };
const PNAME = { "ksc-inland":"KSC Inland (SLF)", "ksc-pads":"KSC Launch Pads (LC-39B)", "cape-inland":"Cape Inland (KXMR)", "cape-pad37":"Cape Launch Pads (SLC-37)", "patrick":"Patrick SFB (KCOF)" };
const VARS = [
  { k:"t",    label:"Temp",            unit:"°F", kind:"cont", grp:"t" },
  { k:"td",   label:"Dew point",       unit:"°F", kind:"cont", grp:"t" },
  { k:"s54",  label:"54 ft sust",      unit:"kt", kind:"cont", grp:"s" },
  { k:"g54",  label:"54 ft peak",      unit:"kt", kind:"cont", grp:"g" },
  { k:"s200", label:"200 ft sust",     unit:"kt", kind:"cont", grp:"s" },
  { k:"g200", label:"200 ft peak",     unit:"kt", kind:"cont", grp:"g" },
  { k:"d",    label:"Direction",       unit:"°",  kind:"cont", grp:"d" },
  { k:"pp",   label:"Precipitation",   unit:"",   kind:"prob", grp:"pp" },
  { k:"lt",   label:"Lightning",       unit:"",   kind:"prob", grp:"lt" },
  { k:"x18",  label:">18 kt sust",     unit:"",   kind:"prob", grp:"x" },
  { k:"x25",  label:">25 kt peak",     unit:"",   kind:"prob", grp:"x" },
  { k:"x35",  label:">35 kt peak",     unit:"",   kind:"prob", grp:"x" },
];
const SRC_NAME = { official:"Official forecast", blend_auto:"Blend, auto-weighted", blend_equal:"Blend, equal weights",
  hrrr:"HRRR", nam3:"NAM 3 km", nbm:"NBM", gfs:"GFS", ifs:"ECMWF IFS", aifs:"ECMWF AIFS", icon:"ICON", gem:"GEM", ukmo:"UKMO",
  gefs:"GEFS", eps:"ECMWF ENS", aifsens:"AIFS ENS", iconeps:"ICON EPS", geps:"GEPS", lav:"LAMP", mav:"GFS MOS", nbs:"NBM text", mex:"GFS MOS ext",
  rrfs:"RRFS", refsm:"REFS members", hrefct:"HREF cal. thunder", refsct:"REFS cal. thunder" };
const GROUP_NAME = { t:"Temperature and dew point", s:"Sustained wind", g:"Peak wind", d:"Wind direction", pp:"Precipitation", lt:"Lightning", x:"Wind thresholds" };
const V = { summary:null, weights:null, status:null, obs:{}, official:[], win:"30", point:"all", band:"all", lvar:"t", rvar:"pp", wgrp:"t", day:null, cpoint:"ksc-inland" };

/* ---------- data ---------- */
/* getJSON and H come from guidance.js */
async function loadAll(){
  const [s, w, st] = await Promise.all([getJSON(VB + "summary.json?ts=" + Date.now()).catch(() => null), getJSON(VB + "weights.json?ts=" + Date.now()).catch(() => null), getJSON(VB + "status.json?ts=" + Date.now()).catch(() => null)]);
  V.summary = s; V.weights = w; V.status = st;
  if (s && s.days && s.days.length && !V.day) V.day = s.days[s.days.length - 1];
  await loadOfficialStore();
  renderAll();
}
async function obsDay(d){
  if (V.obs[d] !== undefined) return V.obs[d];
  try { V.obs[d] = await getJSON(VB + "obs/" + d + ".json"); } catch (e) { V.obs[d] = null; }
  return V.obs[d];
}

/* ---------- combine summary rows for the selected point / band ---------- */
function rowsFor(win, point, band){
  const rows = (V.summary && V.summary.windows[win]) || {}, out = {};
  for (const [key, a] of Object.entries(rows)){
    const [pid, f, b, sid] = key.split("|");
    if (point !== "all" && pid !== point) continue;
    if (band !== "all" && b !== band) continue;
    const vdef = VARS.find(v => v.k === f); if (!vdef) continue;
    const o = ((out[sid] = out[sid] || {})[f] = out[sid][f] || { n:0, e:0, ae:0, se:0, bs:0, p:0, o:0, rel: Array.from({ length:10 }, () => [0, 0, 0]) });
    const n = a[0]; o.n += n;
    if (vdef.kind === "cont"){ o.e += a[1]*n; o.ae += a[2]*n; o.se += a[3]*a[3]*n; }
    else { o.bs += a[1]*n; o.p += a[2]*n; o.o += a[3]*n; if (a[4]) a[4].forEach((r, i) => { o.rel[i][0] += r[0]; o.rel[i][1] += r[1]; o.rel[i][2] += r[2]; }); }
  }
  return out;
}
const metric = (o, vdef) => {
  if (!o || !o.n) return null;
  if (vdef.kind === "cont") return { n:o.n, mae:o.ae/o.n, bias:o.e/o.n, rmse:Math.sqrt(o.se/o.n) };
  const bs = o.bs/o.n, ob = o.o/o.n, ref = ob*(1 - ob);
  return { n:o.n, bs, bss: ref > 0 ? 1 - bs/ref : null, obar:ob, pbar:o.p/o.n };
};
function allRows(){
  const g = rowsFor(V.win, V.point, V.band), off = officialRows();
  if (off) g.official = off;
  return g;
}

/* ---------- official forecasts (published CSVs, scored here) ---------- */
const DB = { name:"erwx-verify", store:"official" };
function idb(){ return new Promise((res, rej) => { const q = indexedDB.open(DB.name, 1); q.onupgradeneeded = () => q.result.createObjectStore(DB.store); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function loadOfficialStore(){ try { const db = await idb(); V.official = await new Promise(r => { const t = db.transaction(DB.store).objectStore(DB.store).get("rows"); t.onsuccess = () => r(t.result || []); t.onerror = () => r([]); }); } catch (e) { V.official = []; } }
async function saveOfficialStore(){ try { const db = await idb(); db.transaction(DB.store, "readwrite").objectStore(DB.store).put(V.official, "rows"); } catch (e) { /* storage unavailable */ } }
function parseCSV(text){
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l && !l.startsWith("#"));
  const split = l => { const out = []; let cur = "", q = false; for (let i = 0; i < l.length; i++){ const ch = l[i]; if (q){ if (ch === '"' && l[i + 1] === '"'){ cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ","){ out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; };
  const head = split(lines[0] || ""); if (!head.includes("valid_start_utc") || !head.includes("issued_utc")) return [];
  return lines.slice(1).map(l => { const c = split(l), o = {}; head.forEach((h, i) => o[h] = c[i]); return o; });
}
function addOfficial(rows){
  const num = v => v === "" || v == null ? null : +v;
  const seen = new Set(V.official.map(r => r.key)); let n = 0;
  for (const r of rows){
    const pid = POINT_OF[r.point]; if (!pid) continue;
    const a = Date.parse(r.valid_start_utc), b = Date.parse(r.valid_end_utc), iss = Date.parse(r.issued_utc); if (!isFinite(a) || !isFinite(iss)) continue;
    const key = `${pid}|${iss}|${a}`; if (seen.has(key)) continue; seen.add(key); n++;
    V.official.push({ key, pid, a, b, iss, len:+r.period_h || 1, lh: new Date(a - 4*H).getUTCHours(),
      t:num(r.temp_f), td:num(r.dewpoint_f), s54:num(r.wind54_sust_kt), g54:num(r.wind54_peak_kt), s200:num(r.wind200_sust_kt), g200:num(r.wind200_peak_kt), d:num(r.wind_dir_deg),
      pp: num(r[+r.period_h >= 6 ? "pop_6h_pct" : +r.period_h >= 3 ? "pop_3h_pct" : "pop_1h_pct"]), lt: num(r[+r.period_h >= 6 ? "ltg_6h_pct" : +r.period_h >= 3 ? "ltg_3h_pct" : "ltg_1h_pct"]),
      x18:num(r.p_sust_gt18kt_pct), x25:num(r.p_peak_gt25kt_pct), x35:num(r.p_peak_gt35kt_pct) });
  }
  saveOfficialStore();
  return n;
}
const bandOf = h => { const bs = (V.weights && V.weights.bands) || [[0,6,"0-6h"],[6,24,"6-24h"],[24,48,"day2"],[48,120,"day3-5"],[120,169,"day6-7"]]; for (const [a, b, n] of bs) if (h >= a && h < b) return n; return bs[bs.length - 1][2]; };
/* observed value for one official row (blocks: highest or lowest temperature, strongest wind, any event) */
function obsFor(row){
  const hrs = []; for (let t = row.a; t < row.b; t += H){ const d = new Date(t), key = d.toISOString().slice(0, 10).replace(/-/g, ""), od = V.obs[key]; if (!od) return null; const p = (od.points || {})[row.pid]; if (!p) return null; hrs.push([p, d.getUTCHours()]); }
  const vals = f => hrs.map(([p, h]) => p[f] ? p[f][h] : null).filter(v => v != null);
  const mx = f => { const v = vals(f); return v.length ? Math.max(...v) : null; }, mn = f => { const v = vals(f); return v.length ? Math.min(...v) : null; };
  const one = row.len === 1, day = row.lh + row.len/2 >= 9 && row.lh + row.len/2 <= 18;
  const any = f => { const v = vals(f); return v.length ? (v.some(x => x) ? 1 : 0) : null; };
  const sx = Math.max(mx("s54x") ?? -1, mx("s200x") ?? -1), gx = Math.max(mx("g54") ?? -1, mx("g200") ?? -1);
  return {
    t: one ? (vals("t")[0] ?? null) : (day ? mx("t") : mn("t")), td: one ? (vals("td")[0] ?? null) : mn("td"),
    s54: one ? (vals("s54")[0] ?? null) : mx("s54"), g54: mx("g54"), s200: one ? (vals("s200")[0] ?? null) : mx("s200"), g200: mx("g200"),
    d: one && (vals("s54")[0] || 0) >= 5 ? (vals("d54")[0] ?? null) : null,
    pp: (() => { const v = vals("pr"); return v.length ? (v.some(x => x >= 0.01) ? 1 : 0) : null; })(),
    lt: (() => { const v = vals("cg10"); return v.length ? (v.some(x => x > 0) ? 1 : 0) : null; })(),
    x18: sx < 0 ? null : sx > 18 ? 1 : 0, x25: gx < 0 ? null : gx > 25 ? 1 : 0, x35: gx < 0 ? null : gx > 35 ? 1 : 0,
  };
}
function officialRows(){
  if (!V.official.length) return null;
  const now = Date.now(), from = now - (+V.win)*86400e3, out = {};
  for (const r of V.official){
    if (r.a < from || r.b > now - 6*H) continue;
    if (V.point !== "all" && r.pid !== V.point) continue;
    if (V.band !== "all" && bandOf((r.a - r.iss)/H) !== V.band) continue;
    const ob = obsFor(r); if (!ob) continue;
    for (const v of VARS){
      const f = r[v.k], o = ob[v.k]; if (f == null || o == null) continue;
      const a = (out[v.k] = out[v.k] || { n:0, e:0, ae:0, se:0, bs:0, p:0, o:0, rel: Array.from({ length:10 }, () => [0, 0, 0]) });
      a.n++;
      if (v.kind === "cont"){ const e = v.k === "d" ? ((f - o + 540) % 360) - 180 : f - o; a.e += e; a.ae += Math.abs(e); a.se += e*e; }
      else { const p = f/100, b = Math.min(9, Math.floor(p*10)); a.bs += (p - o)**2; a.p += p; a.o += o; a.rel[b][0]++; a.rel[b][1] += p; a.rel[b][2] += o; }
    }
  }
  return Object.keys(out).length ? out : null;
}
async function prefetchOfficialObs(){
  const days = new Set(); const from = Date.now() - 90*86400e3;
  for (const r of V.official) if (r.a > from) for (let t = r.a; t < r.b; t += H) days.add(new Date(t).toISOString().slice(0, 10).replace(/-/g, ""));
  await Promise.all([...days].filter(d => (V.summary ? V.summary.days.includes(d) : true)).map(obsDay));
}

/* ---------- rendering ---------- */
const fmt = (v, d) => v == null || !isFinite(v) ? "–" : v.toFixed(d ?? 1);
function heat(vals, better){ const v = vals.filter(x => x != null && isFinite(x)); if (v.length < 2) return () => ""; const lo = Math.min(...v), hi = Math.max(...v); return x => { if (x == null || !isFinite(x) || hi === lo) return ""; let q = (x - lo)/(hi - lo); if (better === "low") q = 1 - q; return `background:rgba(${q > .5 ? "47,122,74" : "178,58,46"},${(Math.abs(q - .5)*0.44).toFixed(3)})`; }; }
function renderScorecard(){
  const g = allRows(), sids = Object.keys(g);
  if (!sids.length){ $("score").innerHTML = `<p class="mut">${V.summary ? "No scored forecasts in this window yet. The verification workflow scores each archived forecast once its hours have observations, so the first scores appear about a day after it starts running." : "No verification data yet. Run the \"Verification and model weights\" workflow, or wait for its hourly run."}</p>`; return; }
  const m = {}; sids.forEach(s => { m[s] = {}; VARS.forEach(v => m[s][v.k] = metric(g[s][v.k], v)); });
  const overall = s => { const ks = VARS.filter(v => v.kind === "cont" && m[s][v.k]); if (!ks.length) return 99; return ks.reduce((a, v) => a + m[s][v.k].mae/(v.k === "d" ? 20 : v.k[0] === "t" ? 2 : 3), 0)/ks.length; };
  const order = sids.sort((a, b) => (a === "official" ? -1 : b === "official" ? 1 : 0) || overall(a) - overall(b));
  const cols = VARS.map(v => ({ v, h: heat(order.map(s => m[s][v.k] ? (v.kind === "cont" ? m[s][v.k].mae : m[s][v.k].bss) : null), v.kind === "cont" ? "low" : "high") }));
  let h = `<table class="sc"><thead><tr><th>Source</th>${VARS.map(v => `<th>${v.label}<small>${v.kind === "cont" ? `MAE ${v.unit}` : "Brier skill"}</small></th>`).join("")}<th>Pairs</th></tr></thead><tbody>`;
  for (const s of order){
    const n = Math.max(0, ...VARS.map(v => m[s][v.k] ? m[s][v.k].n : 0));
    h += `<tr class="${s === "official" ? "off" : s.startsWith("blend") ? "bl" : ""}"><th>${SRC_NAME[s] || s}</th>${cols.map(({ v, h: hf }) => { const x = m[s][v.k]; if (!x) return `<td class="na">–</td>`; return v.kind === "cont" ? `<td style="${hf(x.mae)}" title="n=${x.n}, RMSE ${fmt(x.rmse)}, bias ${fmt(x.bias)}">${fmt(x.mae)}<small>${x.bias >= 0 ? "+" : ""}${fmt(x.bias)}</small></td>` : `<td style="${hf(x.bss)}" title="n=${x.n}, Brier ${fmt(x.bs, 3)}, observed ${fmt(x.obar*100, 0)}%, forecast ${fmt(x.pbar*100, 0)}%">${x.bss == null ? `<span class="mut">no events</span><small>Brier ${fmt(x.bs, 3)}</small>` : fmt(x.bss, 2)}</td>`; }).join("")}<td class="n">${n.toLocaleString()}</td></tr>`;
  }
  h += `</tbody></table>`;
  $("score").innerHTML = h;
  V.lastScore = { order, m };
}
function svgLine(series, xs, ylab){
  const W = 640, Hh = 260, L = 48, R = 16, T = 14, B = 34;
  const all = series.flatMap(s => s.ys).filter(v => v != null); if (!all.length) return `<p class="mut">Not enough scored forecasts yet.</p>`;
  const lo = 0, hi = Math.max(...all)*1.15 || 1;
  const x = i => L + i*(W - L - R)/Math.max(1, xs.length - 1), y = v => T + (1 - (v - lo)/(hi - lo))*(Hh - T - B);
  let g = `<svg viewBox="0 0 ${W} ${Hh}" class="ch" role="img" aria-label="${ylab} by lead time">`;
  for (let k = 0; k <= 4; k++){ const v = lo + (hi - lo)*k/4; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gr"/><text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${v.toFixed(1)}</text>`; }
  xs.forEach((l, i) => g += `<text x="${x(i)}" y="${Hh - 12}" class="ax" text-anchor="middle">${l}</text>`);
  series.forEach(s => { const pts = s.ys.map((v, i) => v == null ? null : [x(i), y(v)]).filter(Boolean); if (!pts.length) return; g += `<path d="M${pts.map(p => p.join(",")).join("L")}" fill="none" stroke="${s.c}" stroke-width="${s.w || 2}" ${s.dash ? 'stroke-dasharray="5 4"' : ""}/>` + pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="${s.c}"/>`).join(""); });
  return g + `</svg><div class="lg">${series.map(s => `<span><i style="background:${s.c}"></i>${s.name}</span>`).join("")}</div>`;
}
const PAL = ["#0E7C86","#B5862B","#5A6ACF","#B23A2E","#2F7A4A","#8A4FA0","#C2621E","#4A5767"];
function renderLead(){
  const v = VARS.find(x => x.k === V.lvar), bands = (V.summary && V.summary.bands) || [];
  const per = {}; bands.forEach(b => { const g = rowsFor(V.win, V.point, b); for (const s in g){ const x = metric(g[s][v.k], v); (per[s] = per[s] || {})[b] = x ? (v.kind === "cont" ? x.mae : x.bss) : null; } });
  const ranked = Object.keys(per).filter(s => !s.startsWith("blend")).sort((a, b) => { const avg = s => { const vs = bands.map(x => per[s][x]).filter(q => q != null); return vs.length ? vs.reduce((p, q) => p + q, 0)/vs.length : (v.kind === "cont" ? 99 : -99); }; return v.kind === "cont" ? avg(a) - avg(b) : avg(b) - avg(a); }).slice(0, 5);
  const series = [...["blend_auto","blend_equal"].filter(s => per[s]).map((s, i) => ({ name:SRC_NAME[s], c: i ? "#7E8A97" : "#13202E", w:3, dash: !!i, ys: bands.map(b => per[s][b] ?? null) })), ...ranked.map((s, i) => ({ name:SRC_NAME[s] || s, c:PAL[i], ys: bands.map(b => per[s][b] ?? null) }))];
  $("leadSel").innerHTML = VARS.map(x => `<option value="${x.k}" ${x.k === V.lvar ? "selected" : ""}>${x.label}</option>`).join("");
  $("lead").innerHTML = svgLine(series, bands, v.kind === "cont" ? `MAE (${v.unit})` : "Brier skill") + `<p class="mut">${v.kind === "cont" ? `Mean absolute error in ${v.unit}; lower is better.` : "Brier skill score against the observed frequency; higher is better, 0 is no better than climatology."} Top five sources plus the two blends.</p>`;
}
function renderReliability(){
  const v = VARS.find(x => x.k === V.rvar); $("relSel").innerHTML = VARS.filter(x => x.kind === "prob").map(x => `<option value="${x.k}" ${x.k === V.rvar ? "selected" : ""}>${x.label}</option>`).join("");
  const g = allRows(), want = ["official","blend_auto","blend_equal", ...Object.keys(g).filter(s => !/^blend|official/.test(s) && g[s][v.k] && g[s][v.k].n).sort((a, b) => (metric(g[a][v.k], v).bss ?? -9) > (metric(g[b][v.k], v).bss ?? -9) ? -1 : 1).slice(0, 2)];
  const W = 340, Hh = 340, L = 44, R = 12, T = 12, B = 40, x = p => L + p*(W - L - R), y = p => T + (1 - p)*(Hh - T - B);
  let s = `<svg viewBox="0 0 ${W} ${Hh}" class="ch sq" role="img" aria-label="Reliability diagram for ${v.label}">`;
  for (let k = 0; k <= 10; k += 2){ s += `<line x1="${x(k/10)}" x2="${x(k/10)}" y1="${T}" y2="${Hh - B}" class="gr"/><line x1="${L}" x2="${W - R}" y1="${y(k/10)}" y2="${y(k/10)}" class="gr"/><text x="${x(k/10)}" y="${Hh - B + 14}" class="ax" text-anchor="middle">${k*10}</text><text x="${L - 6}" y="${y(k/10) + 4}" class="ax" text-anchor="end">${k*10}</text>`; }
  s += `<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="#7E8A97" stroke-dasharray="4 4"/>`;
  s += `<text x="${(L + W - R)/2}" y="${Hh - 6}" class="ax" text-anchor="middle">Forecast probability (%)</text>`;
  const used = [];
  want.forEach((sid, i) => { const o = g[sid] && g[sid][v.k]; if (!o || !o.n) return; const pts = o.rel.map((r, b) => r[0] >= 5 ? [r[1]/r[0], r[2]/r[0], r[0]] : null).filter(Boolean); if (pts.length < 2) return; const c = sid === "official" ? "#B5862B" : sid === "blend_auto" ? "#13202E" : sid === "blend_equal" ? "#7E8A97" : PAL[i]; used.push([sid, c, metric(o, v)]); s += `<path d="M${pts.map(p => `${x(p[0])},${y(p[1])}`).join("L")}" fill="none" stroke="${c}" stroke-width="2.5"/>` + pts.map(p => `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="${Math.min(7, 2 + Math.log10(p[2]))}" fill="${c}"/>`).join(""); });
  s += `</svg>`;
  $("rel").innerHTML = used.length ? s + `<div class="lg">${used.map(([sid, c, m]) => `<span><i style="background:${c}"></i>${SRC_NAME[sid] || sid} <b>${fmt(m.bss, 2)}</b></span>`).join("")}</div><p class="mut">On the diagonal means a 30% forecast happened about 30% of the time. Above the line: under-forecast; below: over-forecast. Dot size shows how often each probability was used. Needs the 30- or 90-day window.</p>` : `<p class="mut">Not enough forecasts of ${v.label.toLowerCase()} yet (each probability bin needs 5 or more).</p>`;
}
function renderWeights(){
  const w = V.weights; $("wSel").innerHTML = Object.entries(GROUP_NAME).map(([k, l]) => `<option value="${k}" ${k === V.wgrp ? "selected" : ""}>${l}</option>`).join("");
  if (!w || !w.weights || !Object.keys(w.weights).length){ $("wts").innerHTML = `<p class="mut">No automatic weights yet. They appear once each source has 10 or more scored pairs for a point, parameter and lead time, and stay close to equal until there's more history.</p>`; return; }
  const pid = V.point === "all" ? Object.keys(w.weights)[0] : V.point, grp = (w.weights[pid] || {})[V.wgrp] || {}, bands = (w.bands || []).map(b => b[2]);
  const sids = [...new Set(Object.values(grp).flatMap(o => Object.keys(o)))].sort((a, b) => { const av = s => bands.reduce((p, b2) => p + ((grp[b2] || {})[s] ?? 1), 0); return av(b) - av(a); });
  if (!sids.length){ $("wts").innerHTML = `<p class="mut">No weights for ${GROUP_NAME[V.wgrp].toLowerCase()} at ${PNAME[pid] || pid} yet.</p>`; return; }
  const cell = x => x == null ? `<td class="na">1.00</td>` : `<td style="background:rgba(${x >= 1 ? "47,122,74" : "178,58,46"},${Math.min(.45, Math.abs(Math.log(x))/Math.log(3)*.45).toFixed(3)})">${x.toFixed(2)}</td>`;
  const chk = (w.check || {})[V.wgrp];
  $("wts").innerHTML = `<p class="mut">${PNAME[pid] || pid}${V.point === "all" ? " (choose a point to see others)" : ""}. Updated ${new Date(w.updated).toISOString().slice(0, 16).replace("T", " ")}Z from the last ${w.window_days} days, half-life ${w.half_life_days} days.${chk ? ` Last 30 days: auto-weighted blend ${chk.use ? "beats or matches" : "trails"} the equal blend (${chk.auto} vs ${chk.equal}${V.wgrp === "pp" || V.wgrp === "lt" || V.wgrp === "x" ? " Brier" : " mean squared error"})${chk.use ? "" : ", so these weights are switched off"}.` : ""}</p>
    <table class="sc wt"><thead><tr><th>Source</th>${bands.map(b => `<th>${b}</th>`).join("")}</tr></thead><tbody>${sids.map(s => `<tr><th>${SRC_NAME[s] || s}</th>${bands.map(b => cell((grp[b] || {})[s])).join("")}</tr>`).join("")}</tbody></table>`;
}
/* ---------- case browser ---------- */
async function renderCase(){
  const days = (V.summary && V.summary.days) || [];
  $("caseDay").innerHTML = days.slice().reverse().map(d => `<option value="${d}" ${d === V.day ? "selected" : ""}>${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}</option>`).join("") || `<option>No days yet</option>`;
  $("casePt").innerHTML = Object.entries(PNAME).map(([k, l]) => `<option value="${k}" ${k === V.cpoint ? "selected" : ""}>${l}</option>`).join("");
  if (!V.day){ $("case").innerHTML = `<p class="mut">Observations start collecting with the first workflow run.</p>`; return; }
  const od = await obsDay(V.day); const p = od && od.points && od.points[V.cpoint];
  if (!p){ $("case").innerHTML = `<p class="mut">No observations for that day.</p>`; return; }
  const t0 = Date.parse(`${V.day.slice(0, 4)}-${V.day.slice(4, 6)}-${V.day.slice(6)}T00:00:00Z`);
  const off = V.official.filter(r => r.pid === V.cpoint && r.a >= t0 && r.a < t0 + 86400e3);
  const latest = {}; off.forEach(r => { if (!latest[r.a] || r.iss > latest[r.a].iss) latest[r.a] = r; });
  const fc = k => Array.from({ length:24 }, (_, h) => { const r = latest[t0 + h*H] || Object.values(latest).find(x => x.a <= t0 + h*H && x.b > t0 + h*H); return r ? r[k] : null; });
  const panel = (title, lines, unit, bars, prob) => {
    const W = 620, Hh = 170, L = 40, R = prob ? 36 : 10, T = 12, B = 22;
    const vals = [...lines.flatMap(l => l.ys), ...(bars ? bars.ys : [])].filter(v => v != null); if (!vals.length && !(prob && prob.ys.some(v => v != null))) return `<div class="cp"><h4>${title}</h4><p class="mut">No data.</p></div>`;
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals); if (unit === "°F"){ lo = Math.floor(Math.min(...vals) - 2); hi = Math.ceil(hi + 2); } else hi = Math.max(hi*1.15, unit === "in" ? 0.1 : unit === "n" ? 4 : 1);
    const x = h => L + (h + .5)*(W - L - R)/24, y = v => T + (1 - (v - lo)/(hi - lo))*(Hh - T - B);
    let s = `<svg viewBox="0 0 ${W} ${Hh}" class="ch" role="img" aria-label="${title}">`;
    for (let k = 0; k <= 3; k++){ const v = lo + (hi - lo)*k/3; s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gr"/><text x="${L - 5}" y="${y(v) + 4}" class="ax" text-anchor="end">${v.toFixed(unit === "in" ? 2 : 0)}</text>`; }
    for (let h = 0; h < 24; h += 3) s += `<text x="${x(h)}" y="${Hh - 6}" class="ax" text-anchor="middle">${String(h).padStart(2, "0")}Z</text>`;
    if (bars) bars.ys.forEach((v, h) => { if (v) s += `<rect x="${x(h) - 8}" y="${y(v)}" width="16" height="${y(lo) - y(v)}" fill="${bars.c}" opacity=".7"/>`; });
    lines.forEach(l => { const pts = l.ys.map((v, h) => v == null ? null : [x(h), y(v)]).filter(Boolean); if (pts.length) s += `<path d="M${pts.map(q => q.join(",")).join("L")}" fill="none" stroke="${l.c}" stroke-width="2" ${l.dash ? 'stroke-dasharray="5 4"' : ""}/>`; });
    if (prob){
      const y2 = v => T + (1 - v/100)*(Hh - T - B);
      for (const v of [0, 50, 100]) s += `<text x="${W - R + 4}" y="${y2(v) + 4}" class="ax">${v}%</text>`;
      const pts = prob.ys.map((v, h) => v == null ? null : [x(h), y2(v)]).filter(Boolean); if (pts.length) s += `<path d="M${pts.map(q => q.join(",")).join("L")}" fill="none" stroke="${prob.c}" stroke-width="2" stroke-dasharray="5 4"/>`;
    }
    return `<div class="cp"><h4>${title}</h4>${s}</svg><div class="lg">${[...lines, ...(bars ? [bars] : []), ...(prob ? [prob] : [])].map(l => `<span><i style="background:${l.c}"></i>${l.name}</span>`).join("")}</div></div>`;
  };
  const tot = k => (p[k] || []).reduce((a, b) => a + (b || 0), 0);
  $("case").innerHTML = `<div class="kpis">
      <div><b>${fmt(Math.max(...(p.t || []).filter(v => v != null)), 0)} / ${fmt(Math.min(...(p.t || []).filter(v => v != null)), 0)}°F</b><span>high / low</span></div>
      <div><b>${fmt(Math.max(...[...(p.g54 || []), ...(p.g200 || [])].filter(v => v != null)), 0)} kt</b><span>peak wind</span></div>
      <div><b>${tot("pr").toFixed(2)} in</b><span>MRMS rainfall</span></div>
      <div><b>${tot("cg10")}</b><span>CG flashes within 10 nmi</span></div>
      <div><b>${off.length ? new Set(off.map(r => r.iss)).size : 0}</b><span>official forecasts loaded</span></div></div>
    <div class="cgrid">
      ${panel("Temperature and dew point", [{ name:"Observed temp", ys:p.t || [], c:"#C0462F" }, { name:"Observed dew point", ys:p.td || [], c:"#2F7A4A" }, { name:"Official temp", ys:fc("t"), c:"#C0462F", dash:true }, { name:"Official dew point", ys:fc("td"), c:"#2F7A4A", dash:true }], "°F")}
      ${panel("Winds", [{ name:"54 ft sust", ys:p.s54 || [], c:"#0E7C86" }, { name:"54 ft peak", ys:p.g54 || [], c:"#5A6ACF" }, { name:"200 ft peak", ys:p.g200 || [], c:"#B23A2E" }, { name:"Official 54 ft peak", ys:fc("g54"), c:"#5A6ACF", dash:true }, { name:"Official 200 ft peak", ys:fc("g200"), c:"#B23A2E", dash:true }], "kt")}
      ${panel("Rainfall (MRMS, in) and official chance (%)", [], "in", { name:"MRMS hourly rain", ys:p.pr || [], c:"#2D74E9" }, { name:"Official precip chance", ys:fc("pp"), c:"#B5862B" })}
      ${panel("Lightning (MERLIN CG within 10 nmi) and official chance (%)", [], "n", { name:"CG flashes", ys:p.cg10 || [], c:"#8A4FA0" }, { name:"Official lightning chance", ys:fc("lt"), c:"#B5862B" })}
    </div>`;
}
function renderStatus(){
  const s = V.summary, st = V.status, w = V.weights;
  const obsDays = s && s.days ? s.days.length : 0;
  $("vStatus").innerHTML = s ? `Scores updated <b>${new Date(s.updated).toISOString().slice(0, 16).replace("T", " ")}Z</b> · ${obsDays} days of observations · ${V.official.length.toLocaleString()} official forecast rows loaded${st && st.obs ? ` · last run: towers ${st.obs.winds ? "✓" : "–"}, MERLIN ${st.obs.ltg ? "✓" : "–"}, MRMS ${st.obs.mrms ? "✓" : "–"}, METAR ${st.obs.metar && st.obs.metar.ok ? "✓" : "–"}` : ""}` : `No verification data yet. The <b>Verification and model weights</b> workflow starts building it on its first run.`;
  $("vPoint").innerHTML = `<option value="all">All points</option>` + Object.entries(PNAME).map(([k, l]) => `<option value="${k}" ${k === V.point ? "selected" : ""}>${l}</option>`).join("");
  $("vBand").innerHTML = `<option value="all">All lead times</option>` + ((s && s.bands) || []).map(b => `<option ${b === V.band ? "selected" : ""}>${b}</option>`).join("");
  document.querySelectorAll("#vWin button").forEach(b => b.setAttribute("aria-pressed", b.dataset.w === V.win));
}
function renderAll(){ renderStatus(); renderScorecard(); renderLead(); renderReliability(); renderWeights(); renderCase(); if (V.mode === "exposure") renderExposure(); }
function scorecardCSV(){
  if (!V.lastScore) return "";
  const { order, m } = V.lastScore, q = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
  const head = ["source", ...VARS.flatMap(v => v.kind === "cont" ? [`${v.k}_mae`, `${v.k}_bias`, `${v.k}_n`] : [`${v.k}_brier`, `${v.k}_bss`, `${v.k}_n`])];
  const rows = order.map(s => [SRC_NAME[s] || s, ...VARS.flatMap(v => { const x = m[s][v.k]; return !x ? ["", "", ""] : v.kind === "cont" ? [x.mae.toFixed(2), x.bias.toFixed(2), x.n] : [x.bs.toFixed(4), x.bss == null ? "" : x.bss.toFixed(3), x.n]; })]);
  return [`# Verification, last ${V.win} days, ${V.point === "all" ? "all points" : PNAME[V.point]}, ${V.band === "all" ? "all lead times" : V.band}`, head.join(","), ...rows.map(r => r.map(q).join(","))].join("\r\n") + "\r\n";
}
function bind(){
  document.querySelectorAll('.pagenav a[data-page="verify"]').forEach(a => a.setAttribute("aria-current", "page"));
  $("vWin").onclick = e => { const b = e.target.closest("[data-w]"); if (!b) return; V.win = b.dataset.w; renderAll(); };
  $("vPoint").onchange = e => { V.point = e.target.value; if (V.point !== "all") V.cpoint = V.point; renderAll(); };
  $("vBand").onchange = e => { V.band = e.target.value; renderAll(); };
  $("leadSel").onchange = e => { V.lvar = e.target.value; renderLead(); };
  $("relSel").onchange = e => { V.rvar = e.target.value; renderReliability(); };
  $("wSel").onchange = e => { V.wgrp = e.target.value; renderWeights(); };
  $("caseDay").onchange = e => { V.day = e.target.value; renderCase(); };
  $("casePt").onchange = e => { V.cpoint = e.target.value; renderCase(); };
  const take = async files => {
    let n = 0; for (const f of files){ if (!/\.csv$/i.test(f.name)) continue; n += addOfficial(parseCSV(await f.text())); }
    $("offNote").textContent = n ? `Added ${n.toLocaleString()} forecast rows. Scoring against observations…` : "No new planning forecast rows found (use the CSV the planning page publishes).";
    await prefetchOfficialObs(); renderAll(); if (n) $("offNote").textContent = `Added ${n.toLocaleString()} forecast rows; ${V.official.length.toLocaleString()} kept on this computer.`;
  };
  $("offFiles").onchange = e => { take([...e.target.files]); e.target.value = ""; };
  $("offFolder").onclick = async () => {
    if (!window.showDirectoryPicker){ $("offFiles").click(); return; }
    try { const dir = await window.showDirectoryPicker(); const files = []; for await (const h of dir.values()) if (h.kind === "file" && /\.csv$/i.test(h.name)) files.push(await h.getFile()); take(files); } catch (e) { /* cancelled */ }
  };
  const dz = $("dropZone");
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("on"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("on"));
  dz.addEventListener("drop", e => { e.preventDefault(); dz.classList.remove("on"); take([...e.dataTransfer.files]); });
  $("offClear").onclick = () => { if (!confirm("Remove the official forecasts stored on this computer?")) return; V.official = []; saveOfficialStore(); renderAll(); };
  $("vCsv").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([scorecardCSV()], { type:"text/csv" })); a.download = `Verification_${V.win}d_${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500); };
  $("vPrint").onclick = () => window.print();
  $("vRefresh").onclick = () => { V.obs = {}; loadAll(); };
}
bind();
loadAll().then(prefetchOfficialObs).then(() => { if (V.official.length) renderAll(); });

/* ============================================================
   Exposure forecast verification
   Published exposure CSVs (constraint probabilities, winds at constraint heights, and the guidance
   beside them) scored against the tower at the forecast point and height. Everything stays on this
   computer: constraint values can be proprietary.
   ============================================================ */
const EX = { ops:[], sel:null, csel:null };
const UNIT_KT = { kt:1, mph:0.868976, ms:1.943844, mps:1.943844, fts:0.592484, ftps:0.592484 };
async function loadExposureStore(){ try { const db = await idb(); EX.ops = await new Promise(r => { const t = db.transaction(DB.store).objectStore(DB.store).get("exposure"); t.onsuccess = () => r(t.result || []); t.onerror = () => r([]); }); } catch (e) { EX.ops = []; } }
async function saveExposureStore(){ try { const db = await idb(); db.transaction(DB.store, "readwrite").objectStore(DB.store).put(EX.ops, "exposure"); } catch (e) { /* storage unavailable */ } }
function parseConstraintCol(col){
  let m = col.match(/^p_(sust|peak)(\d+)ft_(gt|ge)([\d.]+)(kt|mph|ms|fts)_pct$/);
  if (m) return { col, type:"wind", kind:m[1], ft:+m[2], op: m[3] === "gt" ? ">" : ">=", v:+m[4]*(UNIT_KT[m[5]] || 1), unitTxt:m[5] === "ms" ? "m/s" : m[5] === "fts" ? "ft/s" : m[5], raw:+m[4], label:`${m[1] === "sust" ? "Sustained" : "Peak"} ${m[2]} ft ${m[3] === "gt" ? ">" : "≥"} ${m[4]} ${m[5] === "ms" ? "m/s" : m[5] === "fts" ? "ft/s" : m[5]}` };
  m = col.match(/^p_temp_(lt|gt)([\d.]+)(F|C)_pct$/);
  if (m){ const f = m[3] === "C" ? +m[2]*9/5 + 32 : +m[2]; return { col, type:"temp", op: m[1] === "lt" ? "<" : ">", v:f, raw:+m[2], unitTxt:"°" + m[3], label:`Temperature ${m[1] === "lt" ? "<" : ">"} ${m[2]}°${m[3]}` }; }
  return null;
}
function addExposureCSV(text, fname){
  const lines = text.replace(/\r/g, "").split("\n");
  const comment = (lines.find(l => l.startsWith("#")) || "").replace(/^#\s*/, "");
  const rows = parseCSV(text); if (!rows.length) return 0;
  const head = Object.keys(rows[0]);
  if (!head.includes("lat") || !head.includes("lon")) return 0;
  const cons = head.map(parseConstraintCol).filter(Boolean);
  const winds = head.map(c => { const m = c.match(/^wind(\d+)ft_(sust|peak)_(kt|mph|mps|ftps)$/); return m ? { col:c, ft:+m[1], kind:m[2], f:UNIT_KT[m[3]] || 1 } : null; }).filter(Boolean);
  if (!cons.length && !winds.length) return 0;
  const iss = Date.parse(rows[0].issued_utc);
  const name = comment.split(". Constraints")[0] || fname.replace(/\.csv$/i, "");
  const id = `${name}|${iss}|${rows[0].point}|${rows[0].valid_start_utc}`;
  if (EX.ops.some(o => o.id === id)) return 0;
  const num = v => v === "" || v == null ? null : +v;
  EX.ops.push({ id, name, file:fname, issued:iss, by:rows[0].forecaster || "", cons, winds,
    rows: rows.map(r => ({ point:r.point, lat:+r.lat, lon:+r.lon, a:Date.parse(r.valid_start_utc), b:Date.parse(r.valid_end_utc), len:+r.period_h || 1,
      f:Object.fromEntries([...cons.map(c => [c.col, num(r[c.col])]), ...winds.map(w => [w.col, num(r[w.col]) == null ? null : num(r[w.col])*w.f])]),
      g:Object.fromEntries([...cons.map(c => [c.col, num(r[c.col + "_guidance"])]), ...winds.map(w => [w.col, num(r[w.col + "_guidance"]) == null ? null : num(r[w.col + "_guidance"])*w.f])]) })).filter(r => isFinite(r.a)) });
  saveExposureStore();
  return 1;
}
/* towers near a point at a height (same rules as the forecast editor) */
function vTowerChoice(lat, lon, ft, field, od){
  const tw = od && od.towers; if (!tw) return null;
  const near = Object.entries(tw).map(([id, r]) => ({ id, r, d: kmBetween(lat, lon, r.lat, r.lon) })).filter(x => x.d <= 4).sort((a, b) => a.d - b.d);
  for (const { id, r, d } of near){
    const hs = Object.keys(r.h).map(Number).sort((a, b) => a - b); if (!hs.length) continue;
    if (field === "t"){ const lo = hs.find(h => r.h[h].t && r.h[h].t.some(v => v != null)); if (lo != null) return { id, d, h:[lo] }; continue; }
    if (hs.includes(ft)) return { id, d, h:[ft] };
    const below = hs.filter(h => h < ft).pop(), above = hs.find(h => h > ft);
    if (below != null && above != null) return { id, d, h:[below, above] };
    const nearest = hs.reduce((a, b) => Math.abs(b - ft) < Math.abs(a - ft) ? b : a);
    if (Math.abs(nearest - ft)/ft <= 0.35) return { id, d, h:[nearest] };
  }
  return null;
}
function vTowerValue(od, ch, ft, field, hour){
  if (!ch || !od.towers[ch.id]) return null; const r = od.towers[ch.id];
  const v = h => (r.h[h] && r.h[h][field]) ? r.h[h][field][hour] : null;
  if (ch.h.length === 1) return v(ch.h[0]);
  const a = v(ch.h[0]), b = v(ch.h[1]); if (a == null || b == null) return null;
  return a + (b - a)*Math.log(ft/ch.h[0])/Math.log(ch.h[1]/ch.h[0]);
}
/* observed for one row: strongest wind (sust uses the highest one-minute mean), lowest/highest temperature */
function exObs(row, need){
  const out = {}; let any = false;
  for (const n of need){
    const vals = [];
    for (let t = row.a; t < row.b; t += H){
      const od = V.obs[new Date(t).toISOString().slice(0, 10).replace(/-/g, "")]; if (!od) continue;
      const field = n.type === "temp" ? "t" : n.kind === "sust" ? "sx" : "g";
      const ch = vTowerChoice(row.lat, row.lon, n.ft || 6, field === "t" ? "t" : "s", od);
      const v = vTowerValue(od, ch, n.ft, field, new Date(t).getUTCHours());
      if (v != null){ vals.push(v); n._tower = n._tower || ch; }
    }
    if (vals.length){ any = true; out[n.key] = n.type === "temp" && n.op === "<" ? Math.min(...vals) : Math.max(...vals); }
  }
  return any ? out : null;
}
const meets = (v, op, thr) => op === ">" ? v > thr : op === ">=" ? v >= thr : op === "<=" ? v <= thr : v < thr;
function exposureScores(){
  const now = Date.now(), from = now - (+V.win)*86400e3;
  const perCon = [], pool = { off:mkAcc(), gd:mkAcc() }, wind = {};
  for (const op of EX.ops){
    for (const c of op.cons){
      const acc = { op, c, off:mkAcc(), gd:mkAcc(), rows:[] };
      for (const r of op.rows){
        if (r.b > now - 3*H || r.a < from) continue;
        const ob = exObs(r, [{ key:"v", type:c.type, kind:c.kind, ft:c.ft, op:c.op }]); if (!ob) continue;
        const ev = meets(ob.v, c.op, c.v) ? 1 : 0, pf = r.f[c.col], pg = r.g[c.col];
        acc.rows.push({ r, obs:ob.v, ev, pf, pg });
        if (pf != null){ addAcc(acc.off, pf/100, ev); addAcc(pool.off, pf/100, ev); }
        if (pg != null){ addAcc(acc.gd, pg/100, ev); addAcc(pool.gd, pg/100, ev); }
      }
      if (acc.rows.length) perCon.push(acc);
    }
    for (const w of op.winds){
      const k = `${w.ft} ft ${w.kind}`, a = (wind[k] = wind[k] || { off:[0,0,0], gd:[0,0,0] });
      for (const r of op.rows){
        if (r.b > now - 3*H || r.a < from) continue;
        const ob = exObs(r, [{ key:"v", type:"wind", kind:w.kind === "sust" ? "mean" : "peak", ft:w.ft }]);
        if (!ob) continue;
        const o = w.kind === "sust" ? maxField(r, w.ft, "s") : ob.v; if (o == null) continue;
        const f = r.f[w.col], g = r.g[w.col];
        if (f != null){ a.off[0]++; a.off[1] += f - o; a.off[2] += Math.abs(f - o); }
        if (g != null){ a.gd[0]++; a.gd[1] += g - o; a.gd[2] += Math.abs(g - o); }
      }
    }
  }
  return { perCon, pool, wind };
}
function maxField(r, ft, field){ const vals = []; for (let t = r.a; t < r.b; t += H){ const od = V.obs[new Date(t).toISOString().slice(0, 10).replace(/-/g, "")]; if (!od) continue; const ch = vTowerChoice(r.lat, r.lon, ft, "s", od); const v = vTowerValue(od, ch, ft, field, new Date(t).getUTCHours()); if (v != null) vals.push(v); } return vals.length ? Math.max(...vals) : null; }
function mkAcc(){ return { n:0, bs:0, o:0, p:0, rel:Array.from({ length:10 }, () => [0, 0, 0]), hit:0, miss:0, fa:0, cn:0 }; }
function addAcc(a, p, o){ a.n++; a.bs += (p - o)**2; a.o += o; a.p += p; const b = Math.min(9, Math.floor(p*10)); a.rel[b][0]++; a.rel[b][1] += p; a.rel[b][2] += o; const yes = p >= 0.5; if (yes && o) a.hit++; else if (!yes && o) a.miss++; else if (yes && !o) a.fa++; else a.cn++; }
function accStats(a){
  if (!a.n) return null; const bs = a.bs/a.n, ob = a.o/a.n, ref = ob*(1 - ob);
  return { n:a.n, ev:a.o, bs, bss: ref > 0 ? 1 - bs/ref : null, pod: a.hit + a.miss ? a.hit/(a.hit + a.miss) : null, far: a.hit + a.fa ? a.fa/(a.hit + a.fa) : null, csi: a.hit + a.miss + a.fa ? a.hit/(a.hit + a.miss + a.fa) : null };
}
async function prefetchExposureObs(){
  const days = new Set(), from = Date.now() - 90*86400e3;
  for (const op of EX.ops) for (const r of op.rows) if (r.a > from) for (let t = r.a; t < r.b; t += H) days.add(new Date(t).toISOString().slice(0, 10).replace(/-/g, ""));
  await Promise.all([...days].map(obsDay));
}
function renderExposure(){
  const box = $("exBody"); if (!box) return;
  $("exNote").textContent = EX.ops.length ? `${EX.ops.length} exposure forecast${EX.ops.length === 1 ? "" : "s"} stored on this computer.` : "";
  if (!EX.ops.length){ box.innerHTML = `<p class="mut">Load the CSV files the exposure page publishes. Each one is scored against the WINDS tower nearest its point, at each constraint's height (interpolated between sensors when needed). Older exports without guidance columns still score; the guidance comparison needs files published after this update.</p>`; return; }
  const S2 = exposureScores(), po = accStats(S2.pool.off), pg = accStats(S2.pool.gd);
  const pct = v => v == null ? "–" : Math.round(v*100) + "%", f2 = v => v == null || !isFinite(v) ? "–" : v.toFixed(2), f3 = v => v == null ? "–" : v.toFixed(3);
  const kp = `<div class="kpis">
    <div><b>${EX.ops.length}</b><span>forecasts loaded</span></div>
    <div><b>${po ? po.n.toLocaleString() : 0}</b><span>constraint periods scored</span></div>
    <div><b>${po ? po.ev : 0}</b><span>periods the constraint was met</span></div>
    <div><b>${po ? f2(po.bss) : "–"}</b><span>Brier skill, official</span></div>
    <div><b>${pg ? f2(pg.bss) : "–"}</b><span>Brier skill, guidance</span></div>
    <div><b>${po && pg ? (pg.bs > 0 ? Math.round((1 - po.bs/pg.bs)*100) + "%" : "–") : "–"}</b><span>forecaster improvement on the guidance (Brier)</span></div></div>`;
  const rowsHtml = S2.perCon.map((a, i) => { const o = accStats(a.off), g = accStats(a.gd); return `<tr data-ci="${i}" class="${EX.csel === i ? "on" : ""}"><th>${hesc(a.op.name)}<small>${hesc(a.c.label)} · issued ${new Date(a.op.issued).toISOString().slice(0, 16).replace("T", " ")}Z${a.op.by ? " by " + hesc(a.op.by) : ""}</small></th><td>${a.rows.length}</td><td>${a.rows.filter(x => x.ev).length}</td><td>${o ? f3(o.bs) : "–"}</td><td>${g ? f3(g.bs) : "–"}</td><td>${o ? pct(o.pod) : "–"}</td><td>${o ? pct(o.far) : "–"}</td><td>${o ? pct(o.csi) : "–"}</td><td>${Math.max(0, ...a.rows.map(x => x.pf ?? 0))}%</td><td>${a.c.type === "temp" ? Math.round(a.c.op === "<" ? Math.min(...a.rows.map(x => x.obs)) : Math.max(...a.rows.map(x => x.obs))) + "°F" : Math.round(Math.max(...a.rows.map(x => x.obs))) + " kt"}</td></tr>`; }).join("");
  const table = S2.perCon.length ? `<div class="scroll"><table class="sc ex"><thead><tr><th>Operation and constraint</th><th>Periods</th><th>Met</th><th>Brier<small>official</small></th><th>Brier<small>guidance</small></th><th>POD<small>≥50%</small></th><th>FAR<small>≥50%</small></th><th>CSI<small>≥50%</small></th><th>Highest<small>forecast</small></th><th>Observed<small>extreme</small></th></tr></thead><tbody>${rowsHtml}</tbody></table></div><p class="mut">Brier score: lower is better. POD, FAR and CSI treat 50% or more as a "yes" forecast. Click a row for its timeline.</p>` : `<p class="mut">None of the loaded forecasts have finished periods with tower observations yet${V.summary ? "" : " (the verification workflow hasn't published observations yet)"}.</p>`;
  const wrows = Object.entries(S2.wind).filter(([, a]) => a.off[0] || a.gd[0]).map(([k, a]) => `<tr><th>${k}</th><td>${a.off[0] ? (a.off[2]/a.off[0]).toFixed(1) : "–"}<small>${a.off[0] ? ((a.off[1]/a.off[0]) >= 0 ? "+" : "") + (a.off[1]/a.off[0]).toFixed(1) : ""}</small></td><td>${a.gd[0] ? (a.gd[2]/a.gd[0]).toFixed(1) : "–"}<small>${a.gd[0] ? ((a.gd[1]/a.gd[0]) >= 0 ? "+" : "") + (a.gd[1]/a.gd[0]).toFixed(1) : ""}</small></td><td class="n">${a.off[0]}</td></tr>`).join("");
  const wt = wrows ? `<h3>Winds at the constraint heights</h3><table class="sc"><thead><tr><th>Height</th><th>Official<small>MAE kt (bias)</small></th><th>Guidance<small>MAE kt (bias)</small></th><th>Periods</th></tr></thead><tbody>${wrows}</tbody></table>` : "";
  box.innerHTML = kp + `<div class="vgrid"><section class="vpanel"><h2>Constraint forecasts</h2>${table}</section><section class="vpanel wide"><h2>Timeline</h2><div id="exTl"></div></section><section class="vpanel narrow"><h2>Reliability, all constraints</h2><div id="exRel"></div>${wt}</section></div>`;
  /* reliability: official vs guidance */
  const W = 340, Hh = 320, L = 44, R = 12, T = 12, B = 40, x = p => L + p*(W - L - R), y = p => T + (1 - p)*(Hh - T - B);
  let s = `<svg viewBox="0 0 ${W} ${Hh}" class="ch sq" role="img" aria-label="Reliability of constraint forecasts">`;
  for (let k = 0; k <= 10; k += 2) s += `<line x1="${x(k/10)}" x2="${x(k/10)}" y1="${T}" y2="${Hh - B}" class="gr"/><line x1="${L}" x2="${W - R}" y1="${y(k/10)}" y2="${y(k/10)}" class="gr"/><text x="${x(k/10)}" y="${Hh - B + 14}" class="ax" text-anchor="middle">${k*10}</text><text x="${L - 6}" y="${y(k/10) + 4}" class="ax" text-anchor="end">${k*10}</text>`;
  s += `<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="#7E8A97" stroke-dasharray="4 4"/><text x="${(L + W - R)/2}" y="${Hh - 6}" class="ax" text-anchor="middle">Forecast probability (%)</text>`;
  [[S2.pool.off, "#B5862B"], [S2.pool.gd, "#13202E"]].forEach(([a, c]) => { const pts = a.rel.map(r => r[0] >= 3 ? [r[1]/r[0], r[2]/r[0], r[0]] : null).filter(Boolean); if (pts.length >= 2) s += `<path d="M${pts.map(p => `${x(p[0])},${y(p[1])}`).join("L")}" fill="none" stroke="${c}" stroke-width="2.5"/>` + pts.map(p => `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="${Math.min(7, 2 + Math.log10(p[2]))}" fill="${c}"/>`).join(""); });
  $("exRel").innerHTML = s + `</svg><div class="lg"><span><i style="background:#B5862B"></i>Official</span><span><i style="background:#13202E"></i>Guidance</span></div>`;
  renderExTimeline(S2);
}
function renderExTimeline(S2){
  const box = $("exTl"); if (!box) return;
  if (EX.csel == null || !S2.perCon[EX.csel]) EX.csel = S2.perCon.length ? 0 : null;
  if (EX.csel == null){ box.innerHTML = `<p class="mut">Nothing to show yet.</p>`; return; }
  const a = S2.perCon[EX.csel], rows = a.rows.slice().sort((p, q) => p.r.a - q.r.a), c = a.c;
  const W = 760, Hh = 260, L = 44, R = 44, T = 14, B = 34, n = rows.length;
  const obsV = rows.map(r => r.obs), lo = Math.min(...obsV, c.v)*0.9, hi = Math.max(...obsV, c.v)*1.1;
  const x = i => L + (i + 0.5)*(W - L - R)/n, y = v => T + (1 - (v - lo)/(hi - lo || 1))*(Hh - T - B), yp = p => T + (1 - p/100)*(Hh - T - B), bw = Math.max(3, (W - L - R)/n*0.6);
  let s = `<svg viewBox="0 0 ${W} ${Hh}" class="ch" role="img" aria-label="${hesc(c.label)} timeline">`;
  for (const p of [0, 50, 100]) s += `<line x1="${L}" x2="${W - R}" y1="${yp(p)}" y2="${yp(p)}" class="gr"/><text x="${W - R + 4}" y="${yp(p) + 4}" class="ax">${p}%</text>`;
  rows.forEach((r, i) => { if (r.ev) s += `<rect x="${x(i) - (W - L - R)/n/2}" y="${T}" width="${(W - L - R)/n}" height="${Hh - T - B}" fill="rgba(178,58,46,.10)"/>`; if (r.pf != null) s += `<rect x="${x(i) - bw/2}" y="${yp(r.pf)}" width="${bw}" height="${yp(0) - yp(r.pf)}" fill="#B5862B" opacity=".75"><title>${new Date(r.r.a).toISOString().slice(5, 16).replace("T", " ")}Z official ${r.pf}%${r.pg != null ? `, guidance ${r.pg}%` : ""}, observed ${Math.round(r.obs)}${c.type === "temp" ? "°F" : " kt"}</title></rect>`; });
  const gp = rows.map((r, i) => r.pg == null ? null : `${x(i)},${yp(r.pg)}`).filter(Boolean); if (gp.length) s += `<path d="M${gp.join("L")}" fill="none" stroke="#13202E" stroke-width="1.8" stroke-dasharray="5 4"/>`;
  s += `<path d="M${rows.map((r, i) => `${x(i)},${y(r.obs)}`).join("L")}" fill="none" stroke="#0E7C86" stroke-width="2.2"/>` + rows.map((r, i) => `<circle cx="${x(i)}" cy="${y(r.obs)}" r="2.6" fill="#0E7C86"/>`).join("");
  s += `<line x1="${L}" x2="${W - R}" y1="${y(c.v)}" y2="${y(c.v)}" stroke="#B23A2E" stroke-dasharray="3 3"/><text x="${L + 4}" y="${y(c.v) - 5}" class="ax" fill="#B23A2E">limit ${c.type === "temp" ? Math.round(c.v) + "°F" : Math.round(c.v) + " kt"}</text>`;
  for (let k = 0; k <= 4; k++){ const v = lo + (hi - lo)*k/4; s += `<text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${Math.round(v)}</text>`; }
  rows.forEach((r, i) => { if (i % Math.ceil(n/8) === 0) s += `<text x="${x(i)}" y="${Hh - 12}" class="ax" text-anchor="middle">${new Date(r.r.a).toISOString().slice(8, 13).replace("T", " ")}Z</text>`; });
  const tw = rows.length && c._tower;
  box.innerHTML = `<p class="mut">${hesc(a.op.name)}: ${hesc(c.label)}. Observed ${c.type === "temp" ? "temperature" : c.kind === "sust" ? "highest one-minute mean wind" : "peak wind"} in each period at the nearest tower${c.type === "wind" ? ` at ${c.ft} ft` : ""}; shaded periods met the constraint.</p>` + s + `</svg><div class="lg"><span><i style="background:#B5862B"></i>Official probability</span><span><i style="border-top:2px dashed #13202E"></i>Guidance probability</span><span><i style="background:#0E7C86"></i>Observed</span><span><i style="background:rgba(178,58,46,.4)"></i>Constraint met</span></div>`;
}
const hesc = s2 => String(s2).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function bindExposure(){
  const take = async files => {
    let n = 0; for (const f of files){ if (!/\.csv$/i.test(f.name)) continue; n += addExposureCSV(await f.text(), f.name); }
    $("exNote").textContent = n ? `Added ${n} exposure forecast${n === 1 ? "" : "s"}. Scoring…` : "No new exposure forecasts found (use the CSV the exposure page publishes).";
    await prefetchExposureObs(); renderExposure();
  };
  $("exFiles").onchange = e => { take([...e.target.files]); e.target.value = ""; };
  $("exFolder").onclick = async () => { if (!window.showDirectoryPicker){ $("exFiles").click(); return; } try { const dir = await window.showDirectoryPicker(); const files = []; for await (const h of dir.values()) if (h.kind === "file" && /\.csv$/i.test(h.name)) files.push(await h.getFile()); take(files); } catch (e) { /* cancelled */ } };
  const dz = $("exDrop");
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("on"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("on"));
  dz.addEventListener("drop", e => { e.preventDefault(); dz.classList.remove("on"); take([...e.dataTransfer.files]); });
  $("exClear").onclick = () => { if (!confirm("Remove the exposure forecasts stored on this computer?")) return; EX.ops = []; saveExposureStore(); renderExposure(); };
  $("exBody").addEventListener("click", e => { const r = e.target.closest("[data-ci]"); if (!r) return; EX.csel = +r.dataset.ci; renderExposure(); });
  $("vMode").onclick = e => { const b = e.target.closest("[data-m]"); if (!b) return; setMode(b.dataset.m); };
}
function setMode(m){
  V.mode = m; document.body.dataset.vmode = m;
  document.querySelectorAll("#vMode button").forEach(b => b.setAttribute("aria-pressed", b.dataset.m === m));
  try { localStorage.setItem("erwx:verifyMode", m); } catch (e) { /* ignore */ }
  if (m === "exposure") prefetchExposureObs().then(renderExposure);
}
bindExposure();
/* forecasts published from this browser are kept automatically (with their guidance) */
async function ingestPublished(){
  try {
    const db = await idb();
    const arr = await new Promise(r => { const t = db.transaction(DB.store).objectStore(DB.store).get("published"); t.onsuccess = () => r(t.result || []); t.onerror = () => r([]); });
    let np = 0, ne = 0;
    for (const x of arr){ if (x.kind === "planning") np += addOfficial(parseCSV(x.text)); else if (x.kind === "exposure") ne += addExposureCSV(x.text, x.name + ".csv"); }
    return { np, ne, n: arr.length };
  } catch (e) { return { np:0, ne:0, n:0 }; }
}
loadExposureStore().then(ingestPublished).then(async r => { if (r && (r.np || r.ne)){ await Promise.all([prefetchOfficialObs(), prefetchExposureObs()]); renderAll(); } }).then(() => { let m = "planning"; try { m = localStorage.getItem("erwx:verifyMode") || (location.hash === "#exposure" ? "exposure" : "planning"); } catch (e) { /* ignore */ } if (location.hash === "#exposure") m = "exposure"; setMode(m); });
