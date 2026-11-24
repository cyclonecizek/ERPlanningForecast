# Graph editing fix (personal repo)

Copy these files into cyclonecizek/ERPlanningForecast at the same paths, replacing the old ones, then commit and push.

| File | Change |
|---|---|
| docs/planning-app.js | Graph clicks read through the chart's own screen transform (zoom, display scaling, remote desktops); drags keep working when the browser refuses pointer capture; the graph redraws in the same frame as the pointer move (less lag); `?chartdebug=1` diagnostic line |
| docs/index.html, docs/exposure.html, docs/burn.html, docs/lmef.html | Version stamps (cache refresh) |
| docs/ER_Weather_Tools.html | Offline copy rebuilt |
| README.md | "Graph editing on managed or remote computers" |

After pushing, hard-refresh (Ctrl+F5).
