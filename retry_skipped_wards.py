import pandas as pd
import requests

from full_results_downloader import (
    BASE_URL,
    OUTPUT_DIR,
    build_result_row,
    extract_data,
    write_outputs,
)
from incremental_fct_pull import load_existing_rows, merge_rows


REQUEST_TIMEOUT = 180


def main():
    skipped_path = OUTPUT_DIR / "incremental_skipped.csv"
    if not skipped_path.exists():
        print(f"No skipped ward file found at {skipped_path}")
        return

    skipped = pd.read_csv(skipped_path).fillna("")
    ward_rows = skipped[skipped["Ward ID"].astype(str).str.len() > 0]
    if ward_rows.empty:
        print("No skipped ward IDs are available to retry directly.")
        return

    existing = load_existing_rows()
    pulled_rows = []
    still_failed = []

    with requests.Session() as session:
        session.headers.update({"User-Agent": "AfricaDataWarehouseResultSpooler/1.0"})
        for _, item in ward_rows.iterrows():
            election_id = item["Election ID"]
            lga_name = item["LGA"]
            ward_name = item["Ward"]
            ward_id = item["Ward ID"]
            print(f"Retrying {lga_name} / {ward_name}")

            try:
                response = session.get(
                    f"{BASE_URL}/elections/{election_id}/pus",
                    params={"ward": ward_id},
                    timeout=REQUEST_TIMEOUT,
                )
                response.raise_for_status()
                pus = extract_data(response.json())
            except requests.RequestException as exc:
                print(f"  Failed: {exc}")
                still_failed.append({**item.to_dict(), "Retry Error": str(exc)})
                continue

            if not isinstance(pus, list):
                still_failed.append({**item.to_dict(), "Retry Error": "Unexpected PU response"})
                continue

            ward = {"_id": ward_id, "name": ward_name, "code": ""}
            rows = [build_result_row("FCT", lga_name, ward, pu, "") for pu in pus]
            pulled_rows.extend(rows)
            print(f"  Pulled {len(rows)} PU rows")

            existing = merge_rows(existing, rows)
            write_outputs(existing)
            print(f"  Combined rows now: {len(existing)}")

    if still_failed:
        retry_failed_path = OUTPUT_DIR / "retry_still_failed.csv"
        pd.DataFrame(still_failed).to_csv(retry_failed_path, index=False)
        print(f"\nStill failed: {len(still_failed)}. See {retry_failed_path}")

    print("\nFinal LGA counts:")
    if existing.empty:
        print("No rows available.")
    else:
        print(existing.groupby("LGA").size().to_string())


if __name__ == "__main__":
    main()
