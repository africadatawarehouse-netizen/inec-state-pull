import argparse
import json
import os
from pathlib import Path

import pandas as pd


DEFAULT_STATE = "Ekiti"
UPLOAD_FIELDS = ["Image URL", "Image File", "Result Updated Time", "Result Info PU"]


def status_file(state):
    return Path("output") / state / "live_status.json"


def csv_file(state):
    return Path("output") / state / "pu_results.csv"


def read_status(state):
    path = status_file(state)
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def first_upload_seen(state):
    return bool(read_status(state).get("first_upload_seen"))


def any_first_upload_seen(states):
    return any(first_upload_seen(state) for state in states)


def has_uploaded_result(row):
    for field in UPLOAD_FIELDS:
        value = str(row.get(field, "")).strip().lower()
        if value and value not in {"nan", "none", "null"}:
            return True
    return False


def summarize_results(state):
    path = csv_file(state)
    if not path.exists():
        return {
            "state": state,
            "first_upload_seen": False,
            "uploaded_count": 0,
            "total_polling_units": 0,
            "max_result_updated_time": "",
        }

    df = pd.read_csv(path)
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
        "state": state,
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


def record_status(state):
    summary = summarize_results(state)
    path = status_file(state)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    write_github_output(summary)
    print(json.dumps(summary, indent=2, sort_keys=True))


def main():
    parser = argparse.ArgumentParser(description="Track live upload status for scheduled refreshes.")
    parser.add_argument("command", choices=["first-upload-seen", "any-first-upload-seen", "record"])
    parser.add_argument("--state", default=DEFAULT_STATE)
    parser.add_argument("--states", nargs="+", default=[DEFAULT_STATE])
    args = parser.parse_args()

    if args.command == "first-upload-seen":
        print("true" if first_upload_seen(args.state) else "false")
    elif args.command == "any-first-upload-seen":
        print("true" if any_first_upload_seen(args.states) else "false")
    else:
        record_status(args.state)


if __name__ == "__main__":
    main()
