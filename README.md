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
