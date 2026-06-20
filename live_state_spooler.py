import argparse
import re
import sqlite3
import subprocess
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pandas as pd
import requests

from full_results_downloader import (
    BASE_URL,
    collect_election,
    discover_elections,
    get_json,
    make_summary,
    numeric_party_columns,
)


STATE_ROUTES = {
    "fct": "FCT",
    "ekiti": "Ekiti",
    "enugu": "Enugu",
    "kano": "Kano",
    "kebbi": "Kebbi",
    "nasarawa": "Nasarawa",
    "ondo": "Ondo",
    "osun": "Osun",
    "rivers": "Rivers",
}


def parse_irev_url(url):
    parsed = urlparse(url)
    query = parse_qs(parsed.query)

    direct_match = re.search(r"/elections/([0-9a-f]{24})/?$", parsed.path)
    if direct_match:
        return {
            "direct_election_ids": [direct_match.group(1)],
            "election_type_id": None,
            "state_id": None,
        }

    state_id = query.get("state_id", [None])[0]
    match = re.search(r"/elections/types/([^/?#]+)", parsed.path)
    election_type_id = match.group(1) if match else None
    if not state_id or not election_type_id:
        raise ValueError("IReV URL must look like /elections/<election_id> or /elections/types/<type_id>?state_id=<id>")
    return {
        "direct_election_ids": [],
        "election_type_id": election_type_id,
        "state_id": int(state_id),
    }


def normalize_numeric_columns(df):
    for col in [
        "Ballots Issued",
        "Ballots Used",
        "Invalid Votes",
        "Total Accredited",
        "Total Registered",
        "Valid Votes",
        *numeric_party_columns(df),
    ]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)
    return df


def add_upload_count_columns(ward_summary, lga_summary, state_summary, upload_counts=None):
    upload_counts = upload_counts or {}
    lga_counts = upload_counts.get("lga", {})
    ward_counts = upload_counts.get("ward", {})
    total_uploaded = upload_counts.get("state_uploaded")
    total_expected = upload_counts.get("state_expected")
    has_endpoint_counts = bool(lga_counts or ward_counts or total_uploaded is not None)

    if not lga_summary.empty:
        lga_summary["INEC Uploaded Results"] = lga_summary["LGA"].map(lambda lga: int(lga_counts.get(str(lga), 0)))
        fallback = (not has_endpoint_counts) & lga_summary["INEC Uploaded Results"].eq(0)
        if fallback.any():
            lga_summary.loc[fallback, "INEC Uploaded Results"] = lga_summary.loc[fallback, "Polling Units"]
        lga_summary["INEC Upload Percent"] = (
            lga_summary["INEC Uploaded Results"] / lga_summary["Polling Units"].replace(0, pd.NA) * 100
        ).fillna(0).round(1)

    if not ward_summary.empty:
        ward_summary["INEC Uploaded Results"] = ward_summary.apply(
            lambda row: int(ward_counts.get((str(row["LGA"]), str(row["Ward"])), 0)),
            axis=1,
        )
        fallback = (not has_endpoint_counts) & ward_summary["INEC Uploaded Results"].eq(0)
        if fallback.any():
            ward_summary.loc[fallback, "INEC Uploaded Results"] = ward_summary.loc[fallback, "Polling Units"]
        ward_summary["INEC Upload Percent"] = (
            ward_summary["INEC Uploaded Results"] / ward_summary["Polling Units"].replace(0, pd.NA) * 100
        ).fillna(0).round(1)

    if not state_summary.empty:
        if total_uploaded is None:
            total_uploaded = int(lga_summary["INEC Uploaded Results"].sum()) if "INEC Uploaded Results" in lga_summary else 0
        if not total_expected:
            total_expected = int(state_summary["Polling Units"].sum()) if "Polling Units" in state_summary else 0
        state_summary["INEC Uploaded Results"] = int(total_uploaded or 0)
        state_summary["INEC Expected Results"] = int(total_expected or 0)
        state_summary["INEC Upload Percent"] = (
            (state_summary["INEC Uploaded Results"] / state_summary["INEC Expected Results"].replace(0, pd.NA) * 100)
            .fillna(0)
            .round(1)
        )


def write_state_outputs(state_name, df, upload_counts=None):
    out_dir = Path("output") / state_name
    out_dir.mkdir(parents=True, exist_ok=True)
    df = normalize_numeric_columns(df.copy())
    sort_columns = [
        col
        for col in ["State", "LGA", "Ward", "PU Code", "Polling Unit", "PU ID"]
        if col in df.columns
    ]
    if sort_columns:
        df = df.sort_values(sort_columns, kind="stable").reset_index(drop=True)
    if df.empty:
        df.to_csv(out_dir / "pu_results.csv", index=False)
        return

    ward_summary = make_summary(df, ["State", "LGA", "Ward"])
    lga_summary = make_summary(df, ["State", "LGA"])
    state_summary = make_summary(df, ["State"])
    add_upload_count_columns(ward_summary, lga_summary, state_summary, upload_counts)

    df.to_csv(out_dir / "pu_results.csv", index=False)
    ward_summary.to_csv(out_dir / "ward_summary.csv", index=False)
    lga_summary.to_csv(out_dir / "lga_summary.csv", index=False)
    state_summary.to_csv(out_dir / "state_summary.csv", index=False)

    with pd.ExcelWriter(out_dir / "results.xlsx", engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="PU Results", index=False)
        ward_summary.to_excel(writer, sheet_name="Ward Summary", index=False)
        lga_summary.to_excel(writer, sheet_name="LGA Summary", index=False)
        state_summary.to_excel(writer, sheet_name="State Summary", index=False)

    with sqlite3.connect(out_dir / "results.sqlite") as conn:
        df.to_sql("pu_results", conn, if_exists="replace", index=False)
        ward_summary.to_sql("ward_summary", conn, if_exists="replace", index=False)
        lga_summary.to_sql("lga_summary", conn, if_exists="replace", index=False)
        state_summary.to_sql("state_summary", conn, if_exists="replace", index=False)


def fetch_upload_counts(session, election_ids):
    lga_counts = {}
    ward_counts = {}
    state_uploaded = 0
    state_expected = 0

    for election_id in election_ids:
        payload = get_json(session, f"{BASE_URL}/elections/{election_id}/lga")
        lga_blocks = payload.get("data") or []
        result_counts = {str(item.get("_id")): int(item.get("count") or 0) for item in payload.get("results") or []}

        for block in lga_blocks:
            lga = block.get("lga") or {}
            lga_id = str(lga.get("_id") or "")
            lga_name = lga.get("name") or "Unknown LGA"
            expected = len(block.get("wards") or [])
            state_expected += sum(len((ward.get("polling_units") or [])) for ward in block.get("wards") or [])
            uploaded = result_counts.get(lga_id, 0)
            lga_counts[lga_name] = lga_counts.get(lga_name, 0) + uploaded
            state_uploaded += uploaded

            if not lga_id:
                continue

            try:
                ward_payload = get_json(session, f"{BASE_URL}/elections/{election_id}/lga/{lga_id}")
            except Exception as exc:
                print(f"WARNING: failed upload-count lookup for {lga_name}: {exc}", flush=True)
                continue
            ward_result_counts = {
                str(item.get("_id")): int(item.get("count") or 0) for item in ward_payload.get("results") or []
            }
            lga_data = ward_payload.get("data") or {}
            wards = lga_data.get("wards") or block.get("wards") or []
            for ward in wards:
                ward_id = str(ward.get("_id") or "")
                ward_name = ward.get("name") or "Unknown Ward"
                ward_counts[(lga_name, ward_name)] = ward_counts.get((lga_name, ward_name), 0) + ward_result_counts.get(ward_id, 0)

    return {
        "lga": lga_counts,
        "ward": ward_counts,
        "state_uploaded": state_uploaded,
        "state_expected": state_expected,
    }


def spool_state_once(state_name, irev_url, date_prefix=None, download_files=False):
    irev_target = parse_irev_url(irev_url)
    all_rows = []
    skipped = []
    upload_counts = None

    with requests.Session() as session:
        session.trust_env = False
        session.headers.update({"User-Agent": "AfricaDataWarehouseResultSpooler/1.0"})
        direct_election_ids = irev_target["direct_election_ids"]
        if direct_election_ids:
            elections = [{"_id": election_id, "domain": {"name": state_name}} for election_id in direct_election_ids]
            print(f"Using {len(elections)} direct election link(s) for {state_name}.")
        else:
            elections = discover_elections(
                session,
                irev_target["election_type_id"],
                irev_target["state_id"],
                election_date_prefix=date_prefix,
            )
            print(f"Discovered {len(elections)} election(s) for {state_name}.")
            for election in elections:
                domain = election.get("domain") or {}
                print(f"  {domain.get('name', 'Unknown')}: {election.get('_id')}")

        for election in elections:
            rows, skipped_wards = collect_election(session, election["_id"], download_files=download_files)
            for row in rows:
                row["State"] = state_name
            all_rows.extend(rows)
            skipped.extend(skipped_wards)

        upload_counts = fetch_upload_counts(session, [election["_id"] for election in elections])

    df = pd.DataFrame(all_rows)
    write_state_outputs(state_name, df, upload_counts=upload_counts)
    if skipped:
        pd.DataFrame(skipped).to_csv(Path("output") / state_name / "skipped_wards.csv", index=False)
    print(f"{state_name}: wrote {len(df)} PU row(s).")


def publish_state_outputs(state_name):
    paths = [
        f"output/{state_name}",
        "README.md",
    ]
    subprocess.run(["git", "add", *paths], check=True)
    diff = subprocess.run(["git", "diff", "--cached", "--quiet"])
    if diff.returncode == 0:
        print("No output changes to publish.")
        return

    message = f"Refresh {state_name} live results"
    subprocess.run(["git", "commit", "-m", message], check=True)
    subprocess.run(["git", "push"], check=True)
    subprocess.run(["npx", "vercel", "--prod", "--yes"], check=True)
    print(f"Published {state_name} outputs to Vercel.")


def main():
    parser = argparse.ArgumentParser(description="Live spooler for a state election from an INEC IReV URL.")
    parser.add_argument("--state", required=True, choices=sorted(STATE_ROUTES.values()))
    parser.add_argument("--irev-url", required=True, help="IReV election type URL, e.g. https://inecelectionresults.ng/elections/types/...?...state_id=...")
    parser.add_argument("--date-prefix", help="Optional date prefix such as 2026-06-20")
    parser.add_argument("--interval", type=int, default=0, help="Repeat every N seconds. Use 0 for one run.")
    parser.add_argument("--download-files", action="store_true", help="Download result sheets locally.")
    parser.add_argument("--deploy", action="store_true", help="Commit, push, and redeploy Vercel after each successful scrape.")
    args = parser.parse_args()

    while True:
        spool_state_once(args.state, args.irev_url, args.date_prefix, download_files=args.download_files)
        if args.deploy:
            publish_state_outputs(args.state)
        if not args.interval:
            break
        print(f"Sleeping {args.interval} seconds...")
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
