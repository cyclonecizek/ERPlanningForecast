# Update: "Pick on map" in the location row (personal)

Copy these files into cyclonecizek/ERPlanningForecast at the same paths, replacing the old ones, then commit and push.
Do not overwrite `docs/site.config.json`; it is not in this bundle.

| File | Change |
|---|---|
| docs/planning-app.js | "Pick on map" button at the end of the location row: switches to Custom point and opens the map in one step |
| docs/exposure.html, docs/burn.html | Button styling; the location row wraps onto two lines on narrow screens |
| (labels) | SLF and XMR buttons show KSC / CCSFS underneath, like the pads |
| docs/index.html, docs/lmef.html | Version stamps only (cache refresh) |
| docs/ER_Weather_Tools.html | Offline copy rebuilt |
| README.md | Where to find Pick on map |

After pushing, wait a minute for GitHub Pages, then open Exposure and press Ctrl+F5 once.
