import argparse
import json
import os
from pathlib import Path

import pandas as pd


STATUS_FILE = Path("output/Ekiti/live_status.json")
CSV_FILE = Path("output/Ekiti/pu_results.csv")
UPLOAD_FIELDS = ["Image URL", "Image File", "Result Updated Time", "Result Info PU"]


def read_status():
    if not STATUS_FILE.exists():
        return {}
    return json.loads(STATUS_FILE.read_text(encoding="utf-8"))


def first_upload_seen():
    return bool(read_status().get("first_upload_seen"))


def has_uploaded_result(row):
    for field in UPLOAD_FIELDS:
        value = str(row.get(field, "")).strip().lower()
        if value and value not in {"nan", "none", "null"}:
            return True
    return False


def summarize_results():
    if not CSV_FILE.exists():
        return {
            "first_upload_seen": False,
            "uploaded_count": 0,
            "total_polling_units": 0,
            "max_result_updated_time": "",
        }

    df = pd.read_csv(CSV_FILE)
    uploaded_count = int(df.apply(has_uploaded_result, axis=1).sum()) if not df.empty else 0
    max_result_updated_time = ""
    if "Result Updated Time" in df.columns:
        values = [
            str(value).strip()
            for value in df["Result Updated Time"].fillna("")
            if str(value).strip() and str(value).strip().lower() not in {"nan", "none", "null"}
        ]
        max_result_updated_time = max(values) if values else ""

    return {
        "first_upload_seen": uploaded_count > 0,
        "uploaded_count": uploaded_count,
        "total_polling_units": int(len(df)),
        "max_result_updated_time": max_result_updated_time,
    }


def write_github_output(values):
    output_path = os.environ.get("GITHUB_OUTPUT")
    if not output_path:
        return
    with open(output_path, "a", encoding="utf-8") as output:
        for key, value in values.items():
            output.write(f"{key}={str(value).lower() if isinstance(value, bool) else value}\n")


def record_status():
    summary = summarize_results()
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATUS_FILE.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    write_github_output(summary)
    print(json.dumps(summary, indent=2, sort_keys=True))


def main():
    parser = argparse.ArgumentParser(description="Track Ekiti live upload status for scheduled refreshes.")
    parser.add_argument("command", choices=["first-upload-seen", "record"])
    args = parser.parse_args()

    if args.command == "first-upload-seen":
        print("true" if first_upload_seen() else "false")
    else:
        record_status()


if __name__ == "__main__":
    main()
