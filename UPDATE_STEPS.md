# Update: CARTO basemap on all maps + Pick on map (personal)

Copy these files into cyclonecizek/ERPlanningForecast at the same paths, replacing the old ones, then commit and push.
This replaces Personal_Pick_On_Map_Update.zip (everything from it is included). Do not overwrite `docs/site.config.json`.

| File | Change |
|---|---|
| docs/basemap.js | NEW: CARTO basemap (your Rainfall dashboard key) + Esri satellite, style menu, offline coastline fallback |
| docs/pointmap.js | Exposure/Burn point map: basemap tiles, style menu, Web Mercator |
| docs/marine.js, docs/marine.html | Marine map: basemap tiles, style menu, Web Mercator (PDF/HTML products keep the vector coast) |
| docs/planning-app.js | "Pick on map" at the end of the location row (switches to Custom point and opens the map); shorter SLF/XMR labels |
| docs/exposure.html, docs/burn.html | Load basemap.js; map and button styling; location row wraps on narrow screens |
| docs/index.html, docs/lmef.html | Version stamps only (cache refresh) |
| docs/ER_Weather_Tools.html | Offline copy rebuilt (uses tiles when online, coastline when offline) |
| README.md | New "Maps (basemap)" section; Pick on map |

After pushing, wait a minute for GitHub Pages, then hard-refresh (Ctrl+F5) Exposure and Marine.
If a map shows an "API KEY REQUIRED" watermark, the CARTO key isn't registered for cyclonecizek.github.io; switch to Satellite or Coastline only and add the domain on carto.com.
