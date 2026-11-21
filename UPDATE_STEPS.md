# Personal repo: everything not yet pushed (cyclonecizek/ERPlanningForecast)

Checked against your repo as of 20 Nov 23:32Z. The LMEF CSV, Pick on map and CARTO map updates are already in it;
this bundle adds the rest. Copy these files in at the same paths (replacing the old ones), then commit and push.
Do not overwrite `docs/site.config.json` (not in this bundle).

| File | Change |
|---|---|
| docs/convgust.js | NEW: convective gust climatology (45 WS Gumbel fit, flow-regime shifts) and AMU flow regime from GFS |
| docs/planning-app.js | Convective gusts: toggle, flow regime, storm-gust row, mixed peak-wind chances |
| docs/index.html, docs/exposure.html | Convective gusts bar; load convgust.js |
| docs/burn.html, docs/lmef.html | Version stamps (cache refresh) |
| docs/ER_Weather_Tools.html | Offline copy rebuilt |
| pipeline/planning_hires.py | CAM gusts: hourly-max 10 m wind, point / 10 km / 25 km maxima per member; calibration log in docs/data/camlog/ |
| .github/workflows/planning-hires.yml | Commits docs/data/camlog too (the .github folder is hidden on some computers: show hidden files to copy it) |
| README.md | Convective gusts and CAM gusts sections |

After pushing:
1. Hard-refresh (Ctrl+F5). Convective gusts stay off until you tick the box above the table.
2. The pipeline change starts the high-res workflow. In Actions > "Planning forecast high-res guidance" > newest run, check the
   `... wind/gust records:` lines (field names each model has) and any `camlog:` lines, and that the run finishes inside its budget.
