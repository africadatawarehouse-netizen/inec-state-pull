# INEC State Pull

Africa Data Warehouse election result spooler and dashboard.

## Dashboards

- FCT: `/dashboard/FCT/`
- Ekiti: `/dashboard/Ekiti/`
- Osun: `/dashboard/Osun/`
- Manual backup feed: `/dashboard/manual/`
- Local server: `python -m http.server 8080`
- Local URL: `http://localhost:8080/dashboard/`
- Planned domain: `elections.states.africadatawarehouse.org`

The root dashboard has a state dropdown. State-specific data lives in:

- `output/FCT/`
- `output/Ekiti/`
- `output/Osun/`

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

When the Ekiti or Osun IReV election type URL is available, run:

```powershell
python live_state_spooler.py --state Ekiti --irev-url "https://inecelectionresults.ng/elections/types/<TYPE_ID>?state_id=<STATE_ID>" --date-prefix 2026-06-20 --interval 300
```

For Osun:

```powershell
python live_state_spooler.py --state Osun --irev-url "https://inecelectionresults.ng/elections/types/<TYPE_ID>?state_id=<STATE_ID>" --date-prefix 2026-08-15 --interval 300
```

Use `--download-files` if local result-sheet downloads are also needed.

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
