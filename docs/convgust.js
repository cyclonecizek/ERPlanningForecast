"use strict";
/* Convective (thunderstorm) gusts: the 45 WS climatology of the peak wind in a convective period at
   CCSFS/KSC (WINDS towers, KTTS, KXMR; May-Sep 1995-2012), fitted with a Gumbel curve, shifted by the
   AMU flow regime (the "Convective Wind Speed Distribution with Flow Regime" spreadsheet).

     P(peak >= X | convective wind) = 1 - exp(-exp(-((X - shift) - MU)/BETA))

   shift is the regime's change in kt (SW +5.7, NW +5.1, SE-1/2 -0.9, NE -3.5, other 0; the spreadsheet
   enters these with the opposite sign as an adjustment to the threshold). The forecast mixes it with the
   model (background) wind:  P = Pb + Pc * (1 - Pb) * Pconv,  where Pc is the chance a storm affects the
   site (the lightning probability times a share the forecaster can set). The flow regime is assigned the
   way the AMU does it (Lambert 2007, NASA/CR-2007-214732, as in the Cape flow regime dashboard): the
   1000-700 hPa mean wind sectors at MFL, TBW and JAX, resolved with the XMR flow, from GFS at 12Z. */
(function(){
  const MU = 27.21219, BETA = 8.095767;
  const SHIFT = { SW:5.7, NW:5.1, SE:-0.9, NE:-3.5, Other:0 };
  const GROUP_NAME = { SW:"SW (SW-1, SW-2)", NW:"NW", SE:"SE (SE-1, SE-2)", NE:"NE", Other:"Other / any" };
  const groupOf = amu => !amu ? "Other" : /^SW/.test(amu) ? "SW" : /^SE/.test(amu) ? "SE" : amu === "NW" ? "NW" : amu === "NE" ? "NE" : "Other";
  const exceed = (x, shift) => 1 - Math.exp(-Math.exp(-((x - (shift || 0)) - MU)/BETA));
  const quant = (q, shift) => MU - BETA*Math.log(-Math.log(q)) + (shift || 0);
  const BASE_MEDIAN = quant(0.5, 0);
  /* typical storm gust (median) and the high end (90th percentile) for a regime or a set median */
  const range = med => ({ med, hi: med + (quant(0.9, 0) - BASE_MEDIAN) });

  /* AMU regimes (same rules as the Cape flow regime dashboard) */
  const sector = d => { if (d == null || !isFinite(d)) return null; d = ((d % 360) + 360) % 360; return d < 90 ? "NE" : d < 180 ? "SE" : d < 270 ? "SW" : "NW"; };
  const PAT = { "SW,SW,SW":"SW-1", "SE,SW,SW":"SW-2", "SE,SE,SW":"SE-1", "SE,SE,SE":"SE-2", "NW,NW,NW":"NW", "NE,NE,NE":"NE" };
  function amuRegime(mfl, tbw, jax, xmr){
    const syn = [mfl, tbw, jax].every(x => x && x.dir != null) ? (PAT[[mfl, tbw, jax].map(x => sector(x.dir)).join(",")] || "Other") : "Missing";
    const loc = xmr && xmr.dir != null && xmr.spd > 4 ? { SW:"SW-2", SE:"SE-1", NW:"NW", NE:"NE" }[sector(xmr.dir)] : null;
    if (!loc) return syn;
    if (syn === "Other" || syn === "Missing") return loc;
    if (syn === "SW-2" && loc === "SE-1") return "SE-1";
    if (syn === "SE-1" && loc === "SW-2") return "SW-2";
    return syn;
  }
  const STNS = [["mfl", 25.75, -80.38], ["tbw", 27.70, -82.40], ["jax", 30.48, -81.70], ["xmr", 28.48, -80.55]];
  const LEVELS = [1000, 925, 850, 700];
  /* GFS 1000-700 hPa mean wind (vector mean of the four standard levels) at 12Z each day -> { "YYYY-MM-DD": { regime, xmr } } */
  async function fetchRegimes(getJSON){
    const vars = LEVELS.flatMap(l => [`wind_speed_${l}hPa`, `wind_direction_${l}hPa`]).join(",");
    const url = `https://api.open-meteo.com/v1/gfs?latitude=${STNS.map(s => s[1]).join(",")}&longitude=${STNS.map(s => s[2]).join(",")}&hourly=${vars}&wind_speed_unit=kn&timezone=UTC&forecast_days=8`;
    const js = await getJSON(url, 20000), arr = Array.isArray(js) ? js : [js];
    const mean = (h, i) => { let u = 0, v = 0, n = 0;
      for (const l of LEVELS){ const s = h[`wind_speed_${l}hPa`][i], d = h[`wind_direction_${l}hPa`][i]; if (s == null || d == null) continue; const r = d*Math.PI/180; u += -s*Math.sin(r); v += -s*Math.cos(r); n++; }
      if (!n) return null; u /= n; v /= n; return { dir: (Math.atan2(-u, -v)*180/Math.PI + 360) % 360, spd: Math.hypot(u, v) }; };
    const out = {}, t = arr[0].hourly.time;
    t.forEach((ts, i) => { if (!/T12:00$/.test(ts)) return;
      const w = arr.map(a => mean(a.hourly, i)); const day = ts.slice(0, 10);
      out[day] = { regime: amuRegime(w[0], w[1], w[2], w[3]), xmr: w[3] }; });
    return out;
  }
  window.ERWXConv = { MU, BETA, SHIFT, GROUP_NAME, BASE_MEDIAN, groupOf, exceed, quant, range, amuRegime, fetchRegimes,
    SOURCE: "45 WS convective wind climatology (WINDS towers, KTTS, KXMR; May-Sep 1995-2012), Gumbel fit with flow-regime shift" };
})();
