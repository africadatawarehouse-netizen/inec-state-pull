import pandas as pd
import requests

from full_results_downloader import BASE_URL, OUTPUT_DIR, build_result_row, extract_data, write_outputs
from incremental_fct_pull import load_existing_rows, merge_rows


REQUEST_TIMEOUT = 180


def load_ward_queue():
    frames = []
    discovered = OUTPUT_DIR / "fct_discovered_wards.csv"
    if discovered.exists():
        frames.append(pd.read_csv(discovered).fillna(""))

    failed_bwari = OUTPUT_DIR / "retry_still_failed.csv"
    if failed_bwari.exists():
        rows = pd.read_csv(failed_bwari).fillna("")
        rows = rows[["LGA", "Election ID", "Ward", "Ward ID"]]
        rows["Ward Code"] = ""
        frames.append(rows)

    if not frames:
        return pd.DataFrame(columns=["LGA", "Election ID", "Ward", "Ward ID", "Ward Code"])

    queue = pd.concat(frames, ignore_index=True)
    return queue.drop_duplicates(subset=["Election ID", "Ward ID"], keep="last")


def main():
    existing = load_existing_rows()
    queue = load_ward_queue()
    failed = []

    print(f"Existing rows: {len(existing)}")
    if not existing.empty:
        print(existing.groupby("LGA").size().to_string())

    with requests.Session() as session:
        session.headers.update({"User-Agent": "AfricaDataWarehouseResultSpooler/1.0"})
        for _, item in queue.iterrows():
            lga_name = item["LGA"]
            election_id = item["Election ID"]
            ward_name = item["Ward"]
            ward_id = item["Ward ID"]
            ward_code = item.get("Ward Code", "")
            print(f"\nPulling {lga_name} / {ward_name}")

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
                failed.append({**item.to_dict(), "Error": str(exc)})
                continue

            if not isinstance(pus, list):
                failed.append({**item.to_dict(), "Error": "Unexpected PU response"})
                continue

            ward = {"_id": ward_id, "name": ward_name, "code": ward_code}
            rows = [build_result_row("FCT", lga_name, ward, pu, "") for pu in pus]
            existing = merge_rows(existing, rows)
            write_outputs(existing)
            print(f"  Pulled {len(rows)} rows. Combined rows: {len(existing)}")

    if failed:
        failed_path = OUTPUT_DIR / "direct_ward_pull_failed.csv"
        pd.DataFrame(failed).to_csv(failed_path, index=False)
        print(f"\nStill failed: {len(failed)}. See {failed_path}")

    print("\nFinal LGA counts:")
    if existing.empty:
        print("No rows collected.")
    else:
        print(existing.groupby("LGA").size().to_string())


if __name__ == "__main__":
    main()
