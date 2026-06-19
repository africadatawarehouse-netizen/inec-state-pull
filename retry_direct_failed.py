import pandas as pd
import requests

from full_results_downloader import BASE_URL, build_result_row, extract_data, write_outputs
from incremental_fct_pull import load_existing_rows, merge_rows


FAILED_PATH = "output/direct_ward_pull_failed.csv"
REQUEST_TIMEOUT = 240


def main():
    failed = pd.read_csv(FAILED_PATH).fillna("")
    existing = load_existing_rows()
    still_failed = []

    with requests.Session() as session:
        session.headers.update({"User-Agent": "AfricaDataWarehouseResultSpooler/1.0"})
        for _, item in failed.iterrows():
            print(f"Retrying {item['LGA']} / {item['Ward']}")
            try:
                response = session.get(
                    f"{BASE_URL}/elections/{item['Election ID']}/pus",
                    params={"ward": item["Ward ID"]},
                    timeout=REQUEST_TIMEOUT,
                )
                response.raise_for_status()
                pus = extract_data(response.json())
            except requests.RequestException as exc:
                print(f"  Failed: {exc}")
                row = item.to_dict()
                row["Retry Error"] = str(exc)
                still_failed.append(row)
                continue

            ward = {"_id": item["Ward ID"], "name": item["Ward"], "code": item.get("Ward Code", "")}
            rows = [build_result_row("FCT", item["LGA"], ward, pu, "") for pu in pus]
            existing = merge_rows(existing, rows)
            write_outputs(existing)
            print(f"  Pulled {len(rows)} rows. Combined rows: {len(existing)}")

    if still_failed:
        pd.DataFrame(still_failed).to_csv(FAILED_PATH, index=False)
    else:
        pd.DataFrame(columns=["LGA", "Election ID", "Ward", "Ward ID", "Ward Code", "Error"]).to_csv(
            FAILED_PATH,
            index=False,
        )

    print("\nFinal LGA counts:")
    print(existing.groupby("LGA").size().to_string())


if __name__ == "__main__":
    main()
