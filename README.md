# INEC State Pull

Africa Data Warehouse election result spooler and dashboard.

## Current Pilot

- Election: FCT Abuja Chairmanship, February 21, 2026
- Dashboard: `dashboard/index.html`
- Local server: `python -m http.server 8080`
- Local URL: `http://localhost:8080/dashboard/`
- Planned domain: `elections.states.africadatawarehouse.org`

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
