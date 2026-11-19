# Update: Marine forecasts (route and single point)

Upload into your personal **ERPlanningForecast** repository (cyclonecizek/ERPlanningForecast).
**Add file → Upload files**, drag in everything in this folder (except this file), **Commit changes**. As before,
`docs/site.config.json` (your personal settings) and the data the workflows build are left out, so nothing
you've set up is overwritten.

## Changed or new
- `docs/marine.html`, `docs/marine.js` (**new**): the Marine forecasts page
- `docs/data/coast.json` (**new**): the offline coastline for the map (Natural Earth, public domain)
- `docs/index.html`, `taf.html`, `mwp.html`, `burn.html`, `exposure.html`, `lmef.html`, `verify.html`: **Marine** in the page bar
- `docs/guidance.js`, `docs/planning-app.js`: shared code for the wave models and NBM wave height; wave heights as
  ranges on the personal page; Excel rain amounts keep two decimals
- `docs/ER_Weather_Tools.html`, `pipeline/build_standalone.py`: the offline copy now has the Marine tab (built for
  your personal address and settings; the standalone workflow rebuilds it too)
- `README.md`: a Marine forecasts section

No new workflows, secrets or settings.

## Try it
1. Hard-refresh the page and click **Marine**. Add `?demo=1` to the address for a demo route first if you like.
2. **Route:** click the map to drop waypoints (drag to move), set **Depart** and **Speed**, and choose **Rows between
   waypoints**. Or switch to **Times I enter** to type each arrival time. **Open route file** takes a GPX route or
   a CSV of name, lat, lon.
3. **Single point:** click the map (or type lat and lon), then set **From**, **To** and **Every**.
4. Click any value in the forecast to change it; ranges, chances and the summary follow. Set the chance thresholds
   and the range percentiles above the table.
5. Add your initials as **Forecaster**, then **Download PDF**, **HTML**, **CSV** or **Copy text**.

## What stays where
Routes, positions and edits stay in the browser (save routes by name, or to a file). Nothing goes to GitHub.
