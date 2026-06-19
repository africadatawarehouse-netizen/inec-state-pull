from pathlib import Path

import pandas as pd
import requests

from full_results_downloader import (
    FCT_2026_CHAIRMANSHIP_ELECTIONS,
    OUTPUT_DIR,
    collect_election,
    write_outputs,
)


def load_existing_rows():
    path = OUTPUT_DIR / "pu_results.csv"
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path)


def merge_rows(existing, new_rows):
    new_df = pd.DataFrame(new_rows)
    if new_df.empty:
        return existing

    if existing.empty:
        combined = new_df
    else:
        combined = pd.concat([existing, new_df], ignore_index=True)

    dedupe_columns = [column for column in ["Election ID", "PU Code"] if column in combined.columns]
    if dedupe_columns:
        combined = combined.drop_duplicates(subset=dedupe_columns, keep="last")
    return combined


def main():
    existing = load_existing_rows()
    existing_lgas = set(existing.get("LGA", pd.Series(dtype=str)).dropna().unique())
    print(f"Existing rows: {len(existing)}")
    print(f"Existing LGAs: {', '.join(sorted(existing_lgas)) or 'none'}")

    skipped = []
    with requests.Session() as session:
        session.headers.update({"User-Agent": "AfricaDataWarehouseResultSpooler/1.0"})
        for lga_name, election_id in FCT_2026_CHAIRMANSHIP_ELECTIONS:
            if lga_name in existing_lgas:
                print(f"\nSkipping {lga_name}: already present")
                continue

            print(f"\nPulling {lga_name}: {election_id}")
            try:
                rows, skipped_wards = collect_election(session, election_id, download_files=False)
            except requests.RequestException as exc:
                print(f"  Failed {lga_name}: {exc}")
                skipped.append({"LGA": lga_name, "Election ID": election_id, "Error": str(exc)})
                continue

            existing = merge_rows(existing, rows)
            existing_lgas = set(existing.get("LGA", pd.Series(dtype=str)).dropna().unique())
            write_outputs(existing)
            print(f"  Added/updated {len(rows)} rows for {lga_name}. Combined rows: {len(existing)}")

            if skipped_wards:
                skipped.extend(skipped_wards)

    if skipped:
        skipped_path = OUTPUT_DIR / "incremental_skipped.csv"
        pd.DataFrame(skipped).to_csv(skipped_path, index=False)
        print(f"\nSkipped/failed items: {len(skipped)}. See {skipped_path}")

    print("\nFinal LGA counts:")
    if existing.empty:
        print("No rows collected.")
    else:
        print(existing.groupby("LGA").size().to_string())


if __name__ == "__main__":
    main()
