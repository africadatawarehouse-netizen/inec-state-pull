# INEC State Pull

Africa Data Warehouse election result spooler and dashboard.

## Dashboards

- FCT: `/dashboard/FCT/`
- Ekiti: `/dashboard/Ekiti/`
- Osun: `/dashboard/Osun/`
- June 20 by-election feeds: `/dashboard/Enugu/`, `/dashboard/Kano/`, `/dashboard/Kebbi/`, `/dashboard/Nasarawa/`, `/dashboard/Ondo/`, `/dashboard/Rivers/`
- Manual backup feed: `/dashboard/manual/`
- Local server: `python -m http.server 8080`
- Local URL: `http://localhost:8080/dashboard/`
- Planned domain: `elections.states.africadatawarehouse.org`

The root dashboard has a state dropdown. State-specific data lives in:

- `output/FCT/`
- `output/Ekiti/`
- `output/Osun/`
- `output/Enugu/`, `output/Kano/`, `output/Kebbi/`, `output/Nasarawa/`, `output/Ondo/`, `output/Rivers/`

## Refresh Result Data

Figures only:

```powershell
python full_results_downloader.py --no-downloads
```

Figures plus downloaded result-sheet files:

```powershell
python full_results_downloader.py
```

Single LGA/election test:

```powershell
python full_results_downloader.py --election-id 6998247c6a7216db79726383 --no-downloads
```

## Live State Spooling

When the Ekiti or Osun IReV URL is available, run either the direct election URL or the election type URL.

For Ekiti 2026:

```powershell
python live_state_spooler.py --state Ekiti --irev-url "https://inecelectionresults.ng/elections/6a35bb87b4e45d80b33a6e38" --interval 300 --deploy
```

Election type URL format:

```powershell
python live_state_spooler.py --state Ekiti --irev-url "https://inecelectionresults.ng/elections/types/<TYPE_ID>?state_id=<STATE_ID>" --date-prefix 2026-06-20 --interval 300 --deploy
```

For Osun:

```powershell
python live_state_spooler.py --state Osun --irev-url "https://inecelectionresults.ng/elections/types/<TYPE_ID>?state_id=<STATE_ID>" --date-prefix 2026-08-15 --interval 300 --deploy
```

Use `--download-files` if local result-sheet downloads are also needed. The `--deploy` flag commits the updated output files, pushes them to GitHub, and redeploys Vercel after each scrape.

## Ekiti Automatic Refresh

GitHub Actions runs `.github/workflows/ekiti-live-refresh.yml` for the Ekiti live feed:

- Before the first result upload is detected, it checks every 30 minutes.
- Once at least one result upload is detected, it checks every 10 minutes.
- It commits changed `output/Ekiti/` files only after uploaded results exist, so Vercel can redeploy from GitHub without needing a local computer to stay on.
- It can also be started manually from the GitHub Actions tab with the `Ekiti live refresh` workflow.

## Generated Outputs

The dashboard reads:

- `output/pu_results.csv`

The downloader also writes:

- `output/ward_summary.csv`
- `output/lga_summary.csv`
- `output/state_summary.csv`
- `output/INEC_FCT_CHAIRMANSHIP_FULL_RESULTS.xlsx`
- `output/INEC_FCT_CHAIRMANSHIP_FULL_RESULTS.sqlite`

## Deployment Notes

Deploy this repository to Vercel as a static site. The root `index.html` redirects to `/dashboard/`.

Result-sheet links use INEC's public document URLs from the CSV, so the `downloads/` folder does not need to be deployed.
