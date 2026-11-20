"use strict";
/* Shared basemap for the suite's maps (exposure/burn custom point, marine route and point).
   Web Mercator, so the CARTO / Esri tiles line up; view = { lat, lon, k } with k = pixels per degree of
   longitude. Tiles are drawn as SVG <image>s under the map's own drawing; the offline Natural Earth
   coastline stays underneath, so a map with no tiles (offline copy, blocked key, "Coastline only")
   still works. The CARTO key is the same one the Space Coast Rainfall dashboard uses; it is sent with
   every tile request, so it is visible to anyone who opens the page (unavoidable for a map key). */
(function(){
  const CARTO_KEY = "cb1_4mcb_1_ac7cc0264756a5776d9ea703";
  const carto = s => `https://basemaps.cartocdn.com/rastertiles/${s}/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`;
  const CARTO_ATTR = "© OpenStreetMap contributors © CARTO";
  const STYLES = {
    voyager: { name:"Map", url: carto("voyager"), attr: CARTO_ATTR, max:19 },
    light:   { name:"Light", url: carto("light_all"), attr: CARTO_ATTR, max:19 },
    dark:    { name:"Dark", url: carto("dark_all"), attr: CARTO_ATTR, max:19 },
    sat:     { name:"Satellite", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attr: "Imagery © Esri", max:18,
               labels: carto("dark_only_labels"), noRetina:true },
    none:    { name:"Coastline only", url:null, attr:"Coastline: Natural Earth" }
  };
  const LS = "erwx:basemap";
  const getStyle = () => { try { const s = localStorage.getItem(LS); if (s && STYLES[s]) return s; } catch (e) {} return "voyager"; };
  const setStyle = s => { try { localStorage.setItem(LS, s); } catch (e) {} };
  const D = Math.PI/180, my = la => Math.log(Math.tan(Math.PI/4 + Math.max(-85, Math.min(85, la))*D/2));
  function proj(W, H, v){
    const kr = v.k/D, y0 = my(v.lat);
    const pr = { x: lo => (lo - v.lon)*v.k + W/2, y: la => H/2 - (my(la) - y0)*kr,
      lon: x => (x - W/2)/v.k + v.lon, lat: y => Math.atan(Math.sinh(y0 - (y - H/2)/kr))/D };
    pr.bb = [pr.lon(0), pr.lat(H), pr.lon(W), pr.lat(0)];
    return pr;
  }
  /* centre after dragging the map by dx, dy pixels from view v0 */
  const panned = (W, H, v0, dx, dy) => { const pr = proj(W, H, v0); return { ...v0, lon: v0.lon - dx/v0.k, lat: Math.max(-80, Math.min(80, pr.lat(H/2 - dy))) }; };
  /* k (px per degree of longitude) that fits a lat/lon span in a W x H box */
  const fitK = (dlo, laS, laN, W, H) => Math.min(W/Math.max(dlo, 1e-6), H/Math.max(my(laN) - my(laS), 1e-6)*D);
  function tiles(W, H, v, style){
    const st = STYLES[style || getStyle()] || STYLES.voyager;
    if (!st.url) return "";
    const dpr = typeof window !== "undefined" && window.devicePixelRatio > 1.2 && !st.noRetina;
    const worldPx = 360*v.k, z = Math.max(0, Math.min(st.max, Math.round(Math.log2(worldPx/256)))), n = 2 ** z, ts = worldPx/n;
    const gx = lo => (lo + 180)/360*worldPx, gy = la => (1 - my(la)/Math.PI)/2*worldPx;
    const ox = gx(v.lon) - W/2, oy = gy(v.lat) - H/2;
    const x0 = Math.floor(ox/ts), x1 = Math.floor((ox + W)/ts), y0 = Math.max(0, Math.floor(oy/ts)), y1 = Math.min(n - 1, Math.floor((oy + H)/ts));
    if ((x1 - x0 + 1)*(y1 - y0 + 1) > 120) return "";
    const one = (tpl, cls) => { let s = "";
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++){
        const wx = ((tx % n) + n) % n, u = tpl.replace("{z}", z).replace("{x}", wx).replace("{y}", ty).replace("{r}", dpr ? "@2x" : "");
        s += `<image class="${cls}" href="${u}" x="${(tx*ts - ox).toFixed(1)}" y="${(ty*ts - oy).toFixed(1)}" width="${(ts + 0.6).toFixed(1)}" height="${(ts + 0.6).toFixed(1)}" preserveAspectRatio="none" onerror="this.remove()"/>`;
      }
      return s; };
    return `<g class="btiles">${one(st.url, "bt")}${st.labels ? one(st.labels.replace("{r}", dpr ? "@2x" : "{r}"), "bt bl") : ""}</g>`;
  }
  const attribution = style => (STYLES[style || getStyle()] || STYLES.voyager).attr;
  /* the style picker: <select> markup, wired by bindPicker(sel, onChange) */
  const pickerHTML = cls => `<select class="${cls || "bstyle"}" aria-label="Map style">${Object.entries(STYLES).map(([k, s]) => `<option value="${k}"${k === getStyle() ? " selected" : ""}>${s.name}</option>`).join("")}</select>`;
  const bindPicker = (sel, cb) => { if (!sel) return; sel.value = getStyle(); sel.onchange = () => { setStyle(sel.value); cb && cb(sel.value); }; };
  /* for Leaflet maps (the personal page's place picker) */
  const leafletLayer = (L, style) => { const st = STYLES[style || getStyle()]; const s = st && st.url ? st : STYLES.voyager;
    const g = L.layerGroup([L.tileLayer(s.url.replace("{r}", "{r}"), { attribution: s.attr, maxZoom: s.max, detectRetina: false })]);
    if (s.labels) g.addLayer(L.tileLayer(s.labels, { maxZoom: s.max }));
    return g; };
  window.ERWXBase = { STYLES, CARTO_KEY, getStyle, setStyle, proj, panned, fitK, tiles, attribution, pickerHTML, bindPicker, leafletLayer };
})();
