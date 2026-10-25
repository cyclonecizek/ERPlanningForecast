# Planning Forecast

Daily planning forecast for KSC, Cape Canaveral SFS and Patrick SFB, edited by the forecaster and
published as Excel or CSV. Static page on GitHub Pages; everything runs in the browser.

| Selector | Forecast point | MOS station |
|---|---|---|
| KSC Inland | SLF (28.6150, -80.6945) | KTTS |
| KSC Launch Pads | LC-39B (28.6272, -80.6208) | KTTS |
| Cape Inland | KXMR (28.4686, -80.5667) | KXMR |
| Cape Launch Pad | SLC-37 (28.5314, -80.5650) | KXMR |
| Patrick SFB | KCOF (28.2349, -80.6101) | KCOF |

Rows run hourly to 24 h, then 3-hour blocks to day 5, then 6-hour blocks on days 6 and 7.

## Layout
```
docs/index.html                       the planning forecast page
docs/exposure.html                    exposure forecasts for one operation (pads, SLF, XMR or a custom point)
docs/planning-app.js                  the editor shared by the planning and exposure pages
docs/taf.html                         TAF generator: KCOF, KTTS, KXMR or any ICAO
docs/lmef.html, docs/lmef-config.js, docs/lmef.js   Launch Mission Execution Forecast (LMEF)
docs/verify.html, docs/verify.js       Verification dashboard
pipeline/verify.py                     observations, guidance archive, scoring and automatic weights
docs/guidance.js                      guidance engine shared by both pages (fetching, blending, MOS, pipeline)
docs/data/mos/                        MOS, LAMP, NBM text and SPC outlook mirror (written by the workflow)
docs/data/hires.json                  RRFS, REFS members and calibrated thunder (written by the high-res workflow)
pipeline/planning_mos.py              MOS / SPC outlook mirror, Python standard library only
pipeline/planning_hires.py            high-res guidance; needs numpy and pygrib
.github/workflows/planning-mos.yml    runs the mirror twice an hour
.github/workflows/planning-hires.yml  runs the high-res job hourly (downloads only new 00/06/12/18Z runs)
```

## Setup
1. Create an empty repo on GitHub (no README), then from this folder:
   ```
   git init -b main
   git add .
   git commit -m "Planning forecast page"
   git remote add origin https://github.com/<you>/PlanningForecast.git
   git push -u origin main
   ```
2. Settings > Pages: Deploy from a branch, `main`, folder `/docs`.
3. Settings > Actions > General > Workflow permissions: Read and write.
4. Actions tab: run "Planning forecast MOS mirror" and "Planning forecast high-res guidance" once
   (the push in step 1 also starts both).
5. Open `https://<you>.github.io/PlanningForecast/`. Add `?demo=1` to see synthetic data.

## Guidance
* Open-Meteo, fetched by the page: HRRR, NAM 3 km, NBM, GFS, ECMWF IFS, AIFS, ICON, GEM, UKMO,
  plus GEFS, ECMWF ENS, AIFS ENS, ICON EPS and GEPS members.
* High-res workflow: RRFS (3 km, to 84 h), the five RRFS ensemble members that make up REFS
  (to 60 h), and SPC calibrated thunder from the HREF (HREFCT, to 48 h) and REFS (REFSCT, to 60 h),
  1 h and 4 h periods. Calibrated thunder is weighted double in the lightning blend by default.
* MOS: LAMP, GFS MOS, NAM MOS, GFS MOS extended, NBM text (NBS/NBE), via the IEM mirror.
* SPC Day 1-3 categorical outlook for the severe column.
* Lightning comes only from explicit thunder probabilities: calibrated thunder, LAMP, MOS and NBM
  text (no CAPE proxies).

### RRFS / REFS transition
NWS moved the RRFS/REFS implementation, and the retirement of HREF, NAM and NAM MOS, to Nov 3, 2026.
The high-res job looks for RRFS under `rrfs/prod`, `rrfs/v1.0` and `rrfs/para` on NOMADS and on
AWS (`noaa-rrfs-ops-pds`), and for REFSCT under `spc_post/prod` then `spc_post/para`, so it keeps
working through the switch with no edits. After Nov 3, HREFCT and NAM MOS stop appearing and drop
out of the blend on their own (HREFCT after 24 h). Messages are fetched by byte range using each
file's inventory, from AWS where the bytes match, otherwise from NOMADS at about one request per
0.6 s. Each run is capped at 35 minutes and keeps whatever finished.

The page reads `docs/data/mos/` first and falls back to IEM and SPC directly if a file is missing.

## Editing and publishing
* Graph: drag across to draw, Alt+drag erases back to guidance, double-click resets a point.
* Table: click a cell and type or press Enter, Del returns it to guidance, paste a column from Excel.
* Edits are saved in the browser per point and survive a reload. Ctrl+Z / Ctrl+Shift+Z undo and redo.
* Peaks follow sustained-wind edits, WBGT follows temperature and dew point edits, and exceedance
  probabilities shift with wind and temperature edits (toggle under Guidance sources) unless edited.
* Save and publish runs a QC check, then downloads an Excel workbook (one sheet per point) and/or a CSV.

## KCOF TAF generator (`taf.html`)
A separate tool for the Patrick SFB TAF, in Air Force format (AFMAN 15-129) with a 30-hour valid
period. It blends the same guidance as the planning page (models, ensembles, LAMP/MOS/NBM text,
RRFS, REFS members and calibrated thunder) hour by hour at KCOF and writes:

* the initial group, plus BECMG groups (1-hour transitions) where ceiling or visibility category,
  prevailing weather, or wind changes and the change lasts at least the minimum period,
* TEMPO groups (4 hours at most) for thunderstorm or shower chances between the TEMPO and
  prevailing thresholds, with CB on thunderstorm cloud groups,
* visibility in meters rounded down to a reportable value, BR/FG/HZ when needed, VCSH,
* QNH as the lowest forecast altimeter setting in each group, and TX/TN for the valid period.

Everything is editable in the text box, and a format check runs as you type (header, valid period,
group times and lengths, wind and visibility form, weather codes, cloud order and summation, CB with
TS, QNH and TX/TN). Copy or download the result when it's ready. The thresholds for categories,
change groups, TEMPO and weather are under Generator settings and are saved in the browser.
Not generated: WS, icing and turbulence groups, and remarks.

Ceilings come from LAMP, GFS/NAM MOS, NBM text and RRFS/REFS where available; otherwise from the
models' low/mid/high cloud cover. Add `?demo=1` to see it with synthetic data.

## Exposure forecasts (`exposure.html`)
A tailored forecast for one operation, with the same editor, linking and publishing as the planning
page. Pick LC-39A, LC-39B, SLC-41, SLC-40, SLC-37, LC-36, the SLF, XMR or a custom point; set the
valid window, how many hours stay hourly before switching to 3-hour blocks, and any number of
constraints:
* wind: height (ft), sustained or peak, at-or-above or above a speed in kt, mph, m/s or km/h,
* temperature: above or below a value in °F or °C.

Each wind height gets its own sustained/peak rows and graph, and each constraint gets a probability
row (the chance it's met at any time in the row, from all guidance members), which moves with your
wind and temperature edits. Settings and edits are saved in the browser separately from the
planning page. Publishing writes Excel, CSV, PDF and HTML named after the operation.

**Operation templates.** Save the current setup (operation name, point, constraints, hourly setting
and window length) as a named template, then load it for the next one: the start time stays as set
and the end moves to match the template's window length. Templates are kept in the browser, travel
with a workspace file in the offline copy, and Export / Import shares them as a JSON file.

## Leadership quick look
The **Leadership brief** button on the planning page builds a one-page summary from the official
forecast (guidance plus forecaster edits) for all five points: an editable bottom line, a stoplight
chart of days by hazard (lightning, rain, sustained and peak wind thresholds, heat, cold, freeze,
fog/low visibility and SPC severe risk; hazards that never reach moderate are left off and listed
as "not a concern"), the daily sky, high/low and peak gusts, and the key concerns with days, times
and locations. Download it as a PDF or HTML page (both carry the 45 WS patch) or copy it as text
for email. Stoplight levels: lightning, sustained >18 kt, peak >25 kt, cold and fog moderate at
20 %, high at 50 %; rain 30/60 %; heat 30/60 %; peak >35 kt and freeze 10/30 %; SPC marginal is
moderate, slight or higher is high.

### TAF stations
The TAF generator's station bar picks KCOF, KTTS or KXMR, or any other ICAO: type it and press
Load (its position is looked up on aviationweather.gov, or enter latitude and longitude). Each
station keeps its own draft. US stations get LAMP, MOS and NBM text; RRFS and calibrated thunder
come from the nearest pipeline point within 15 km. The valid period can be 24 or 30 hours.

### Brief settings
In the leadership brief, "What the brief shows" turns each hazard and the daily sky, high/low and
gust rows on or off (remembered). Hazards that are off are left out of the chart, bottom line and
key concerns; "Show hazards even when they stay low" keeps all-green rows. Edited wording is kept
when settings change; Regenerate rewrites it from the forecast.

## Launch forecast (LMEF)
`lmef.html` uses the same editor as the planning and exposure forecasts, tailored to the launch.
It opens on the next upcoming Space Coast launch (Launch Library 2, mirrored by the MOS workflow into
`docs/data/launches.json`); pick another or enter the mission, vehicle, pad and windows yourself.

**Editor.** Hourly rows across the launch window and every delay day (add as many as you need), with:
* one row per NASA-STD-4010B lightning launch commit criterion: lightning, cumulus cloud, attached
  anvil, detached anvil, debris cloud, disturbed weather, thick cloud layers, smoke plume and surface
  electric fields; plus Flight Through Precipitation for missions that have it,
* the liftoff wind constraint (any height, sustained or peak, any unit), which follows wind edits,
* the hourly probability of violation combined from those rows: the electrified-cloud rules count as
  one related group (largest rule plus 35 % of the remainder) and thick cloud layers, smoke, flight
  through precipitation and liftoff winds add independently. Edit it directly to override.
* pad weather (sky, temperature, dew point, precipitation and lightning) and 200 ft winds.

The rule first guesses come from the guidance: calibrated (HREF/REFS) and LAMP/MOS thunder for the
electrified-cloud rules (with a 30-minute look-back for lightning and the previous 3 hours for
detached anvils and debris), precipitation and low cloud for the cumulus rule, deep mid-level cloud
for thick layers and disturbed weather. The guidance can't see cloud tops, anvil age or field mills
directly, so these are starting points for the forecaster.

**Product.** Built from the official hourly values: the window PoV is the average of the hourly PoV
(the chance at a random time), the primary concerns are the rules with the highest window averages,
and windows of 2 hours or more get a "PoV through the window" strip. Weather, temperature, humidity,
liftoff winds and clouds come from the same forecast. Any product field can be overridden (shown in
amber, ↺ to go back). Additional risk criteria can be switched off or added:
* Upper-Level Wind Shear: GFS 300-200 hPa winds (100 kt moderate, 140 kt high),
* Booster Recovery Weather: gusts and wave heights at each recovery site against your limits,
* Proton Flux: GOES >=10 MeV flux and the SWPC 3-day S1-or-greater probabilities.

Export as PDF, HTML, Excel or CSV.

## Consistent forecasts across points (planning page)
An edit at one point carries to the others: each other point gets the same adjustment (official
minus guidance) on top of its own guidance, so the differences the guidance expects between points
are kept. Temperatures move by degrees, winds by percentage, probabilities and cloud cover by points.
Distance sets the strength (full within 15 km, tapering to 40 % at 45 km and beyond, so Patrick gets
about 45 % of a KSC change). Cells edited by hand at another point are never overwritten; carried
cells are marked with a teal corner instead of gold. One undo reverses the edit everywhere.
* **Edits also apply to** (above the table): turn linking off, or untick points.
* **Alt (Option):** press it before an edit (or hold it while clicking) to change only this point;
  Esc cancels.
* **Consistency flags:** neighbouring points (within 25 km) whose difference in an edited period strays
  from what the guidance expects (more than 3°F, 5 kt or 30 % of the wind, or 25 points for a
  probability). The list offers Show, Match (give one point the other's adjustment) and "Carry this
  point's edits to the other points"; the flags also appear in the publish check.

## Interactive HTML product
The HTML that Publish writes for the planning and exposure forecasts is an interactive page, not a
copy of the PDF: forecast points as tabs, one continuous table that scrolls with sticky headers and
parameter names, time across or time down, local or UTC, wind units, parameter-group filters, jumps to
each day, graphs with hover readouts, light and dark themes, and a print layout. Customer products
(HTML, PDF, Excel, CSV) show the forecast only: nothing about guidance values or the forecaster's
edits. Each publish also keeps a private verification copy (official values with the guidance beside
them) in that browser, which the Verification tab picks up automatically. It's a single file with no outside links, so it can be emailed or
put on a shared drive.

## Offline copy (one HTML file)
`docs/ER_Weather_Tools.html` has the planning, exposure, LMEF and TAF tools in a single file with
everything built in. Download it from the "Offline copy" link in the tab bar (or from the repo),
save it anywhere, and double-click it to open in Edge or Chrome. Nothing to install and no Python.
* Guidance comes straight from the public services (Open-Meteo, IEM, SPC, aviationweather.gov,
  Launch Library 2, SWPC); the data this repo mirrors (MOS, RRFS/REFS and calibrated thunder, SPC,
  launches, protons) is read from the GitHub Pages site, so the machine needs internet access to them.
* Edits, settings and drafts are saved in that browser on that computer. To share them between
  forecasters, use **Workspace** in the tab bar: "Save workspace file…" writes everyone's
  in-progress planning, exposure, LMEF and TAF work (and an optional handoff note) to one JSON file
  for the shared drive; "Open workspace file…" loads a teammate's file and reloads the tools. Each
  person's initials, time zone, wind units and theme stay their own. In Edge and Chrome the file
  stays linked for the session, so Save updates the same file; otherwise it downloads a new one.
  Opening a file replaces your current work in the tools you tick, after showing who saved it and when.
* The file is rebuilt automatically by the "Build standalone file" workflow whenever the pages change;
  download it again to get updates. To build it by hand: `python pipeline/build_standalone.py`.

## How the guidance is verifying (forecast editor)
Below the graph on the planning, exposure and LMEF pages, a panel plots the last 24 hours of
observations against every guidance source and the blend for the parameter on the graph
(temperature, dew point, 54/200 ft sustained or peak wind, direction), with each source's error
and bias over those hours and its automatic weight. Observations are the verification workflow's
hourly record (towers, or the KCOF METAR at Patrick); a pad without its own record uses the
nearest point within 9 km and says so. Past model values come from their recent runs
(Open-Meteo past_days), so the panel shows how the guidance has been doing today, not a formal
score. Click a source to highlight its line.

## Verification and automatic model weights
`pipeline/verify.py` runs hourly (".github/workflows/verify.yml") and keeps everything under
`docs/data/verif/`:
* **Observations** (`obs/YYYYMMDD.json`), hourly at each forecast point:
  * WINDS towers (codiapi WINDS range API): 54 ft and 200 ft sustained (hour mean and highest
    one-minute mean) and peak winds, direction, temperature and dew point. 200 ft at LC-39B is
    interpolated in log height between the 132 and 257 ft sensors; sides use the prevailing side.
    Tower mapping is at the top of the script (SLF 0412/0313/0512, LC-39B 0211/LC39B, KXMR
    0303/0002, SLC-37 0108/LC37); Patrick has no nearby tower and uses the KCOF METAR.
  * MERLIN cloud-to-ground and cloud-to-cloud counts within 5 and 10 nmi (codiapi lightning range APIs).
  * MRMS MultiSensor QPE 01H Pass2 (gauge-corrected hourly rainfall) from NOAA's AWS archive, at the
    point and the wettest pixel within about 2 km.
  * KTTS, KXMR and KCOF METARs (IEM): temperature, dew point, visibility, thunder.
* **Guidance archive** (`pending/*.json.gz`): at 05Z and 17Z every source's forecast for the next
  7 days at each point (Open-Meteo models and ensembles, the MOS mirror, RRFS/REFS and calibrated
  thunder from `hires.json`), plus an equal-weight and an auto-weighted blend. Each file is scored
  as its hours become final (6 h after valid time) and removed once complete.
* **Scores** (`stats/YYYYMMDD.json`, `summary.json`): error sums by point, parameter, lead band
  (0-6 h, 6-24 h, day 2, days 3-5, days 6-7) and source, and 7/30/90-day scorecards.
* **Weights** (`weights.json`): for each point, parameter group (temperature/dew point, sustained
  wind, peak wind, direction, precipitation, lightning, wind thresholds) and lead band, each source's
  weight is the median error over its own error (mean squared error, or Brier score for
  probabilities), from the last 45 days with a 15-day half-life, shrunk toward 1 until it has about
  150 pairs and kept between 0.25 and 3. A group is switched off if the auto-weighted blend stops
  beating the equal blend over the last 30 days.

The forecast pages read `weights.json` and multiply each source's weight by its factor for the
point (or the nearest verified point), parameter and lead time; "Weight models by how well they
verify here" in Guidance sources turns it off. The **Verification** tab shows the scorecard, skill
by lead time, reliability diagrams, the weights and a day-by-day case browser. Official forecasts
are scored there from the published CSVs you load (files or a whole folder); they stay on that
computer and are never uploaded.

## Exposure forecast verification
The verification workflow also keeps every WINDS tower and sensor height hourly (`towers` in each
obs file: hour mean, highest one-minute mean, highest peak, and temperature), so exposure
constraints can be checked at the pad and height they're written for.
* **Forecast editor:** on the exposure page the "How the guidance is verifying" panel compares any
  wind height or constraint with the nearest tower within 4 km at that height (exact, interpolated
  between two sensors in log height, or the nearest sensor within 35 %), draws the constraint's limit,
  and counts the observed hours that met it.
* **Verification copy:** each publish keeps the official values with the guidance beside them in the
  browser (not in the customer CSV), so verification can show what the forecaster's edits added.
* **Verification tab, Exposure forecasts:** load published exposure CSVs (files or a folder). For each
  operation and constraint it shows the periods scored, how often the constraint was met, Brier scores
  for the official forecast and the guidance, POD/FAR/CSI at 50 %, the highest forecast and observed
  extreme, a timeline of forecast probability against the observed wind and limit, a reliability
  diagram, and wind accuracy at the constraint heights. Exposure forecasts are kept only in that
  browser; nothing (operation names, constraint values) is uploaded.
