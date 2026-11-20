# Update: exposure map picker + LMEF database CSV (Personal)

Copy these files into cyclonecizek/ERPlanningForecast (your personal repo) at the same paths, replacing the old ones, then commit and push.
Do not overwrite `docs/site.config.json`; it is not in this bundle.

| File | Change |
|---|---|
| docs/pointmap.js | NEW: offline map for picking a point (coastline, fixed points, pan/zoom, click to pick) |
| docs/exposure.html, docs/burn.html | "Pick on map" button under the custom point; lat/lon accept degrees-minutes |
| docs/planning-app.js | Custom point: degrees-minutes parsing, map wiring |
| docs/lmef.js | Database CSV: new headers, Mission_ID/Attempt_ID blank, pov_pct_1-6, risktype_4, next_forecast + discussion; windows under 1 hour have one PoV and no trend option |
| docs/verify.js | Loads the new database CSV (and still loads older files) |
| docs/index.html, lmef.html, verify.html | Version stamps only (cache refresh) |
| docs/ER_Weather_Tools.html | Offline copy rebuilt |
| README.md | Exposure map picker, new CSV columns and PoV slots |

After pushing: open Exposure, choose Custom point, press "Pick on map", and click a point. On LMEF, press CSV and check the header row.
A hard refresh (Ctrl+F5) once is enough if the old page is cached.
