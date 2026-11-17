# Personal edition update

Upload everything inside this folder over your personal ERPlanningForecast repository (**Add file → Upload files**,
**Commit changes**; press **Cmd+Shift+.** in Finder first so `.github` uploads). Your `docs/site.config.json` is
included and keeps `"publicPage": false` and `"archive": false`.

New in this update:
- **Daily rainfall range** on the planning page: 10th percentile, median and 90th percentile 24 h totals from the
  guidance members (change them under Guidance sources), in the panel and every product
- **Burn forecasts** now has a **7-day outlook** (the Burn planning forecast, on the page's own guidance) beside the
  **Burn day** view, one prescription with caution values, VPD, KBDI and NWS spot forecast checks; run **Actions →
  Update KBDI → Run workflow** once after uploading

The Special Weather Statement is in the code but stays hidden in this edition (there's no public page here).
