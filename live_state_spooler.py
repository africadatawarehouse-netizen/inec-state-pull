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
    make_summary,
    numeric_party_columns,
)


STATE_ROUTES = {
    "fct": "FCT",
    "ekiti": "Ekiti",
    "osun": "Osun",
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


def write_state_outputs(state_name, df):
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


def spool_state_once(state_name, irev_url, date_prefix=None, download_files=False):
    irev_target = parse_irev_url(irev_url)
    all_rows = []
    skipped = []

    with requests.Session() as session:
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

    df = pd.DataFrame(all_rows)
    write_state_outputs(state_name, df)
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
