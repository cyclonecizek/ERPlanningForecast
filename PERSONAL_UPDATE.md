# Updating the personal edition (github.com/cyclonecizek/ERPlanningForecast)

This is the full suite as one site: no studio and public-page split, no releases, GitHub connection or official
archive (`docs/site.config.json` has `"publicPage": false` and `"archive": false`). Everything else is the same as the
AFSPC edition.

## With git (as before)
From your local clone:
```
git pull
```
Copy everything from this folder into the clone (replace files when asked), then:
```
git add -A
git commit -m "Update to the current ER Weather Forecast Suite (personal edition)"
git push
```

## Or in the browser
In the repository: **Add file → Upload files**, drag in everything inside this folder (with hidden files showing,
**Cmd+Shift+.**, so `.github` comes along), **Commit changes**.

## After the update
- **Actions:** run **planning mos**, **planning hires**, **verify** and **standalone** once. Look for `ECM: … rows`
  (ECMWF MOS) and `hrrrtl: … newest of 6 runs` (time-lagged HRRR) in the logs; the first hires run takes longer.
- **Settings → Actions → General → Workflow permissions:** Read and write (already set if the workflows have been
  committing data).
- Hard-refresh the site (**Cmd+Shift+R**).

## Not included, on purpose
- `publish-public.yml`, `official-archive.yml` and their scripts: this repository is public, so official forecasts
  are never filed here.
- The data the workflows build (`docs/data/`): your live data stays as it is.

To turn this copy into the AFSPC edition, remove `"publicPage": false` and `"archive": false` from
`docs/site.config.json`, set `studioRepo` and `productsPage`, and add the two workflows and scripts.
