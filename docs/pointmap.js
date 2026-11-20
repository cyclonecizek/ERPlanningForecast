"use strict";
/* A small map for picking a point: offline Natural Earth coastline (data/coast.json, the detailed coast around
   Florida), the fixed forecast points for reference, pan by dragging, zoom with the wheel or the buttons, click
   to pick. Used by the exposure and burn custom point. window.ERWXPointMap.mount(el, opts) returns { update }. */
(function(){
  let COAST = null, loading = null;
  function loadCoast(){
    if (COAST) return Promise.resolve(COAST);
    if (loading) return loading;
    const base = typeof window.DATA_BASE === "string" ? window.DATA_BASE : "";
    loading = (window.ERWX_COAST ? Promise.resolve(window.ERWX_COAST) : fetch(base + "data/coast.json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })).then(js => {
      const dec = (rings, q) => rings.map(a => { const out = []; let x = 0, y = 0; for (let i = 0; i < a.length; i += 2){ x += a[i]; y += a[i + 1]; out.push([x/q, y/q]); }
        const b = [180, 90, -180, -90]; for (const [lo, la] of out){ if (lo < b[0]) b[0] = lo; if (la < b[1]) b[1] = la; if (lo > b[2]) b[2] = lo; if (la > b[3]) b[3] = la; } out.bb = b; return out; });
      COAST = { world: dec(js.world.rings, js.world.q), detail: dec(js.detail.rings, js.detail.q), box: js.detail.box };
      return COAST;
    }).catch(() => (COAST = { world:[], detail:[], box:null, err:true }));
    return loading;
  }
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function proj(W, H, v){
    const kx = v.k*Math.cos(v.lat*Math.PI/180);
    return { x: lo => (lo - v.lon)*kx + W/2, y: la => (v.lat - la)*v.k + H/2, lon: x => (x - W/2)/kx + v.lon, lat: y => v.lat - (y - H/2)/v.k,
      bb: [v.lon - W/2/kx, v.lat - H/2/v.k, v.lon + W/2/kx, v.lat + H/2/v.k] };
  }
  function path(rings, pr, bb){
    const mx = (bb[2] - bb[0])*0.08, my = (bb[3] - bb[1])*0.08, E = [bb[0] - mx, bb[1] - my, bb[2] + mx, bb[3] + my]; let d = "";
    for (const r of rings){
      const b = r.bb; if (b[2] < bb[0] || b[0] > bb[2] || b[3] < bb[1] || b[1] > bb[3]) continue;
      let s = "", px = null, py = null;
      for (const [lo0, la0] of r){ const x = pr.x(Math.min(E[2], Math.max(E[0], lo0))), y = pr.y(Math.min(E[3], Math.max(E[1], la0))); if (px != null && Math.abs(x - px) < 0.6 && Math.abs(y - py) < 0.6) continue; s += (s ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1); px = x; py = y; }
      if (s) d += s + "Z";
    }
    return d;
  }
  function mount(el, opts){
    opts = opts || {};
    const H = opts.height || 340;
    let view = { lat: opts.lat != null ? opts.lat : 28.5, lon: opts.lon != null ? opts.lon : -80.6, k: opts.k || 260 };
    let pick = opts.lat != null ? { lat:opts.lat, lon:opts.lon } : null, refs = opts.refs || [];
    el.classList.add("pmap");
    el.innerHTML = `<div class="pmapbox" tabindex="0" aria-label="Map: click to pick the point; drag to pan; scroll, + or - to zoom"></div>
      <div class="pmapbar"><span class="pmaphint">Click to pick the point. Drag to pan; scroll or use + and − to zoom.</span><span class="pmapsp"></span>
      <button type="button" class="btn" data-z="out" aria-label="Zoom out">−</button><button type="button" class="btn" data-z="in" aria-label="Zoom in">+</button><button type="button" class="btn" data-z="fit">Centre on point</button></div>`;
    const box = el.querySelector(".pmapbox");
    function draw(){
      const W = Math.max(280, Math.round(box.clientWidth || 640)), pr = proj(W, H, view), bb = pr.bb;
      let land = "", det = "", mask = "";
      if (COAST && COAST.world){
        land = path(COAST.world, pr, bb);
        if (COAST.box && view.k > 60 && bb[2] > COAST.box[0] && bb[0] < COAST.box[2] && bb[3] > COAST.box[1] && bb[1] < COAST.box[3]){
          det = path(COAST.detail, pr, bb);
          const r = `x="${pr.x(COAST.box[0]).toFixed(1)}" y="${pr.y(COAST.box[3]).toFixed(1)}" width="${(pr.x(COAST.box[2]) - pr.x(COAST.box[0])).toFixed(1)}" height="${(pr.y(COAST.box[1]) - pr.y(COAST.box[3])).toFixed(1)}"`;
          mask = `<clipPath id="pmc"><rect ${r}/></clipPath><mask id="pmm"><rect width="${W}" height="${H}" fill="#fff"/><rect ${r} fill="#000"/></mask>`;
        }
      }
      const span = bb[2] - bb[0], step = span > 16 ? 5 : span > 6 ? 2 : span > 2.5 ? 1 : span > 1 ? 0.5 : 0.1;
      let grid = "", gl = ""; const dp = step < 0.5 ? 1 : step < 1 ? 1 : 0;
      for (let lo = Math.ceil(bb[0]/step)*step; lo <= bb[2]; lo += step){ const x = pr.x(lo); grid += `M${x.toFixed(1)},0V${H}`; gl += `<text x="${(x + 3).toFixed(1)}" y="${H - 5}" class="pgl">${Math.abs(lo).toFixed(dp)}°${lo < 0 ? "W" : "E"}</text>`; }
      for (let la = Math.ceil(bb[1]/step)*step; la <= bb[3]; la += step){ const y = pr.y(la); grid += `M0,${y.toFixed(1)}H${W}`; gl += `<text x="4" y="${(y - 3).toFixed(1)}" class="pgl">${Math.abs(la).toFixed(dp)}°${la < 0 ? "S" : "N"}</text>`; }
      const rf = refs.map(r => `<g class="pref"><circle cx="${pr.x(r.lon).toFixed(1)}" cy="${pr.y(r.lat).toFixed(1)}" r="4"/><text x="${(pr.x(r.lon) + 7).toFixed(1)}" y="${(pr.y(r.lat) + 4).toFixed(1)}">${esc(r.name)}</text></g>`).join("");
      const pk = pick ? `<g class="ppick"><circle cx="${pr.x(pick.lon).toFixed(1)}" cy="${pr.y(pick.lat).toFixed(1)}" r="8"/><circle cx="${pr.x(pick.lon).toFixed(1)}" cy="${pr.y(pick.lat).toFixed(1)}" r="2.5" class="pdot"/></g>` : "";
      box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Map for picking the custom point"><defs>${mask}</defs>
        <rect width="${W}" height="${H}" class="psea"/><path d="${land}" class="pland"${det ? ' mask="url(#pmm)"' : ""}/>${det ? `<path d="${det}" class="pland" clip-path="url(#pmc)"/>` : ""}
        <path d="${grid}" class="pgrid"/>${gl}${rf}${pk}</svg>`;
      if (COAST && COAST.err) el.querySelector(".pmaphint").textContent = "Coastline file not found (data/coast.json); click to pick on the grid.";
    }
    let drag = null;
    const at = ev => { const r = box.getBoundingClientRect(); return { x:ev.clientX - r.left, y:ev.clientY - r.top, W:r.width }; };
    box.addEventListener("pointerdown", ev => { const p = at(ev); drag = { x0:p.x, y0:p.y, v0:{ ...view }, moved:false }; box.setPointerCapture(ev.pointerId); });
    box.addEventListener("pointermove", ev => { if (!drag) return; const p = at(ev), dx = p.x - drag.x0, dy = p.y - drag.y0; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; if (!drag.moved) return;
      view.lon = drag.v0.lon - dx/(drag.v0.k*Math.cos(drag.v0.lat*Math.PI/180)); view.lat = Math.max(-80, Math.min(80, drag.v0.lat + dy/drag.v0.k)); draw(); });
    box.addEventListener("pointerup", ev => { if (!drag) return; const p = at(ev), d = drag; drag = null; if (d.moved) return;
      const pr = proj(p.W, H, view); pick = { lat: +pr.lat(p.y).toFixed(4), lon: +pr.lon(p.x).toFixed(4) }; draw(); if (opts.onPick) opts.onPick(pick.lat, pick.lon); });
    const zoom = (f, p) => { const W = box.clientWidth || 640, pr = proj(W, H, view), lo = p ? pr.lon(p.x) : view.lon, la = p ? pr.lat(p.y) : view.lat;
      view.k = Math.max(20, Math.min(4000, view.k*f)); if (p){ const q = proj(W, H, view); view.lon += lo - q.lon(p.x); view.lat += la - q.lat(p.y); } draw(); };
    box.addEventListener("wheel", ev => { ev.preventDefault(); zoom(ev.deltaY < 0 ? 1.25 : 0.8, at(ev)); }, { passive:false });
    el.querySelector(".pmapbar").addEventListener("click", ev => { const b = ev.target.closest("[data-z]"); if (!b) return;
      if (b.dataset.z === "in") zoom(1.5); else if (b.dataset.z === "out") zoom(1/1.5); else if (pick){ view.lat = pick.lat; view.lon = pick.lon; draw(); } });
    window.addEventListener("resize", () => { if (el.offsetParent) draw(); });
    loadCoast().then(draw); draw();
    return { update(o){ if (o.lat != null && isFinite(o.lat) && o.lon != null && isFinite(o.lon)){ pick = { lat:+o.lat, lon:+o.lon }; if (o.center){ view.lat = pick.lat; view.lon = pick.lon; } } if (o.refs) refs = o.refs; draw(); }, redraw: draw };
  }
  window.ERWXPointMap = { mount };
})();
