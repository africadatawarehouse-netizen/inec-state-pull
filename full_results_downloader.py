import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
import sqlite3
import time
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd
import requests


BASE_URL = "https://dolphin-app-sleqh.ondigitalocean.app/api/v1"

# FCT Abuja Chairmanship election type and state id from the public IReV route:
# https://inecelectionresults.ng/elections/types/5f129a04df41d910dcdc1d55?state_id=15
DEFAULT_ELECTION_TYPE_ID = "5f129a04df41d910dcdc1d55"
DEFAULT_STATE_ID = 15
DEFAULT_ELECTION_DATE_PREFIX = "2026-02-21"

OUTPUT_DIR = Path("output")
DOWNLOAD_DIR = Path("downloads")
EXCEL_FILE = OUTPUT_DIR / "INEC_FCT_CHAIRMANSHIP_FULL_RESULTS.xlsx"
SQLITE_FILE = OUTPUT_DIR / "INEC_FCT_CHAIRMANSHIP_FULL_RESULTS.sqlite"

REQUEST_TIMEOUT = 90
REQUEST_SLEEP_SECONDS = 0.03
MAX_RETRIES = 1
MAX_WARD_WORKERS = 8
FCT_2026_CHAIRMANSHIP_ELECTIONS = [
    ("MUNICIPAL", "699824ea5e30c3dcf4748623"),
    ("KWALI", "699824bf40728bdc366f87e2"),
    ("KUJE", "6998247c6a7216db79726383"),
    ("GWAGWALADA", "699824519b43a9dac5181864"),
    ("BWARI", "69982413b8681ed991c31906"),
    ("ABAJI", "699823817f928ed7ee3bcfb5"),
]


def ensure_dirs() -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)
    DOWNLOAD_DIR.mkdir(exist_ok=True)


def get_json(session: requests.Session, url: str) -> dict:
    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = session.get(url, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            last_error = exc
            if attempt == MAX_RETRIES:
                break
            wait_seconds = attempt * 3
            print(f"    Request failed; retrying in {wait_seconds}s ({attempt}/{MAX_RETRIES}): {exc}", flush=True)
            time.sleep(wait_seconds)
    raise last_error


def extract_data(payload):
    if isinstance(payload, dict):
        return payload.get("data", payload)
    return payload


def safe_text(value, default=""):
    return default if value is None else str(value)


def safe_filename(value: str) -> str:
    keep = []
    for char in safe_text(value):
        if char.isalnum() or char in ("-", "_", "."):
            keep.append(char)
        elif char in ("/", "\\", " "):
            keep.append("_")
    return "".join(keep).strip("_") or "unknown"


def document_extension(url: str) -> str:
    path = urlparse(url).path
    ext = Path(path).suffix.lower()
    if ext in {".jpg", ".jpeg", ".png", ".pdf"}:
        return ext
    return ".jpg"


def download_document(session: requests.Session, url: str, pu_code: str, lga_name: str) -> str:
    if not url:
        return ""

    folder = DOWNLOAD_DIR / safe_filename(lga_name)
    folder.mkdir(exist_ok=True)
    filename = f"{safe_filename(pu_code)}{document_extension(url)}"
    path = folder / filename

    if path.exists() and path.stat().st_size > 0:
        return str(Path(safe_filename(lga_name)) / filename)

    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = session.get(url, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            path.write_bytes(response.content)
            return str(Path(safe_filename(lga_name)) / filename)
        except requests.RequestException as exc:
            last_error = exc
            if attempt == MAX_RETRIES:
                break
            wait_seconds = attempt * 3
            print(f"    Download failed; retrying in {wait_seconds}s ({attempt}/{MAX_RETRIES}): {exc}", flush=True)
            time.sleep(wait_seconds)
    raise last_error


def parse_votes(votes_value):
    if not votes_value:
        return {}

    if isinstance(votes_value, str):
        try:
            votes = json.loads(votes_value)
        except json.JSONDecodeError:
            return {}
    else:
        votes = votes_value

    parsed = {}
    for party in votes or []:
        code = safe_text(party.get("party_code")).upper()
        if code:
            parsed[code] = party.get("vote")
    return parsed


def get_polling_unit_name(pu):
    polling_unit = pu.get("polling_unit") or {}
    return pu.get("name") or polling_unit.get("name") or ""


def get_pu_code(pu):
    polling_unit = pu.get("polling_unit") or {}
    return pu.get("pu_code") or polling_unit.get("pu_code") or ""


def get_lga_name_from_block(lga_block):
    lga = lga_block.get("lga") or {}
    return lga.get("name") or "Unknown LGA"


def get_state_name_from_block(lga_block):
    state = lga_block.get("state")
    if isinstance(state, dict):
        return state.get("name") or "Unknown State"
    lga = lga_block.get("lga") or {}
    state = lga.get("state")
    if isinstance(state, dict):
        return state.get("name") or "Unknown State"
    election = lga_block.get("election") or {}
    state = election.get("state")
    if isinstance(state, dict):
        return state.get("name") or "Unknown State"
    return "Unknown State"


def build_result_row(state_name, lga_name, ward, pu, image_filename):
    election = pu.get("election") or {}
    row = {
        "State": state_name,
        "LGA": lga_name,
        "Election ID": election.get("_id", ""),
        "Election Name": election.get("full_name", ""),
        "Election Date": election.get("election_date", ""),
        "Ward": ward.get("name", ""),
        "Ward Code": ward.get("code", ""),
        "Ward ID": ward.get("_id", ""),
        "Polling Unit": get_polling_unit_name(pu),
        "PU Code": get_pu_code(pu),
        "PU ID": pu.get("_id", ""),
        "Polling Unit ID": pu.get("polling_unit_id", ""),
        "Result Updated Time": pu.get("result_updated_time"),
        "Session": pu.get("session"),
        "Ballots Issued": pu.get("ballots_issued"),
        "Ballots Used": pu.get("ballots_used"),
        "Invalid Votes": pu.get("invalid_votes"),
        "Result Info PU": pu.get("result_info_pu"),
        "Total Accredited": pu.get("total_accredited"),
        "Total Registered": pu.get("total_registered"),
        "Valid Votes": pu.get("valid_votes"),
        "Image File": image_filename,
        "Image URL": ((pu.get("document") or {}).get("url") or ""),
    }

    row.update(parse_votes(pu.get("votes")))
    return row


def numeric_party_columns(df):
    metadata_columns = {
        "State",
        "LGA",
        "Election ID",
        "Election Name",
        "Election Date",
        "Ward",
        "Ward Code",
        "Ward ID",
        "Polling Unit",
        "PU Code",
        "PU ID",
        "Polling Unit ID",
        "Result Updated Time",
        "Session",
        "Ballots Issued",
        "Ballots Used",
        "Invalid Votes",
        "Result Info PU",
        "Total Accredited",
        "Total Registered",
        "Valid Votes",
        "Image File",
        "Image URL",
    }
    return [col for col in df.columns if col not in metadata_columns]


def make_summary(df, group_columns):
    sum_columns = [
        "Ballots Issued",
        "Ballots Used",
        "Invalid Votes",
        "Total Accredited",
        "Total Registered",
        "Valid Votes",
    ]
    sum_columns.extend(numeric_party_columns(df))
    existing_sum_columns = [col for col in sum_columns if col in df.columns]
    summary = df.groupby(group_columns, dropna=False)[existing_sum_columns].sum().reset_index()
    summary["Polling Units"] = df.groupby(group_columns, dropna=False).size().values
    return summary


def write_outputs(df):
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

    ward_summary = make_summary(df, ["State", "LGA", "Ward"])
    lga_summary = make_summary(df, ["State", "LGA"])
    state_summary = make_summary(df, ["State"])

    with pd.ExcelWriter(EXCEL_FILE, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="PU Results", index=False)
        ward_summary.to_excel(writer, sheet_name="Ward Summary", index=False)
        lga_summary.to_excel(writer, sheet_name="LGA Summary", index=False)
        state_summary.to_excel(writer, sheet_name="State Summary", index=False)

    with sqlite3.connect(SQLITE_FILE) as conn:
        df.to_sql("pu_results", conn, if_exists="replace", index=False)
        ward_summary.to_sql("ward_summary", conn, if_exists="replace", index=False)
        lga_summary.to_sql("lga_summary", conn, if_exists="replace", index=False)
        state_summary.to_sql("state_summary", conn, if_exists="replace", index=False)

    df.to_csv(OUTPUT_DIR / "pu_results.csv", index=False)
    ward_summary.to_csv(OUTPUT_DIR / "ward_summary.csv", index=False)
    lga_summary.to_csv(OUTPUT_DIR / "lga_summary.csv", index=False)
    state_summary.to_csv(OUTPUT_DIR / "state_summary.csv", index=False)

    return ward_summary, lga_summary, state_summary


def discover_elections(session, election_type_id, state_id, election_date_prefix=None):
    url = f"{BASE_URL}/elections"
    payload = get_json(
        session,
        f"{url}?election_type={election_type_id}&state_id={state_id}",
    )
    elections = extract_data(payload)
    if not isinstance(elections, list):
        raise ValueError("Unexpected elections response. Expected a list under the 'data' key.")

    if election_date_prefix:
        elections = [
            election
            for election in elections
            if safe_text(election.get("election_date")).startswith(election_date_prefix)
        ]

    current_lga_elections = []
    seen_lgas = set()
    for election in elections:
        domain = election.get("domain") or {}
        lga_name = domain.get("name") or election.get("full_name") or election.get("_id")
        if lga_name in seen_lgas:
            continue
        seen_lgas.add(lga_name)
        current_lga_elections.append(election)

    return current_lga_elections


def fetch_ward_results(election_id, state_name, lga_name, ward, download_files):
    rows = []
    skipped_ward = None
    ward_id = ward.get("_id")
    ward_name = ward.get("name", "")
    if not ward_id:
        return rows, skipped_ward

    with requests.Session() as session:
        session.trust_env = False
        session.headers.update({"User-Agent": "AfricaDataWarehouseResultSpooler/1.0"})
        print(f"  Ward: {lga_name} / {ward_name}", flush=True)
        pu_url = f"{BASE_URL}/elections/{election_id}/pus?ward={ward_id}"
        try:
            pus = extract_data(get_json(session, pu_url))
        except requests.RequestException as exc:
            print(f"    Skipped ward after retries: {lga_name} / {ward_name} ({exc})", flush=True)
            skipped_ward = {
                "Election ID": election_id,
                "LGA": lga_name,
                "Ward": ward_name,
                "Ward ID": ward_id,
                "Error": str(exc),
            }
            return rows, skipped_ward

        if not isinstance(pus, list):
            skipped_ward = {
                "Election ID": election_id,
                "LGA": lga_name,
                "Ward": ward_name,
                "Ward ID": ward_id,
                "Error": "Unexpected PU response",
            }
            print(f"    Skipped unexpected PU response for {lga_name} / {ward_name}", flush=True)
            return rows, skipped_ward

        for pu in pus:
            pu_code = get_pu_code(pu)
            image_url = ((pu.get("document") or {}).get("url") or "")
            image_filename = ""

            if image_url and download_files:
                try:
                    image_filename = download_document(session, image_url, pu_code, lga_name)
                    print(f"    Downloaded/kept: {image_filename}", flush=True)
                except requests.RequestException as exc:
                    print(f"    Failed download for {pu_code}: {exc}", flush=True)

            rows.append(build_result_row(state_name, lga_name, ward, pu, image_filename))
            time.sleep(REQUEST_SLEEP_SECONDS)

    return rows, skipped_ward


def collect_election(session: requests.Session, election_id: str, download_files: bool = True):
    rows = []
    skipped_wards = []
    print(f"Fetching LGA data for election: {election_id}", flush=True)
    lga_url = f"{BASE_URL}/elections/{election_id}/lga"
    lga_blocks = extract_data(get_json(session, lga_url))

    if not isinstance(lga_blocks, list):
        raise ValueError("Unexpected LGA response. Expected a list under the 'data' key.")

    print(f"Found {len(lga_blocks)} LGA block(s).", flush=True)

    for lga_block in lga_blocks:
        state_name = get_state_name_from_block(lga_block)
        lga_name = get_lga_name_from_block(lga_block)
        wards = lga_block.get("wards") or []

        print(f"\nProcessing {state_name} / {lga_name}: {len(wards)} ward(s)", flush=True)

        with ThreadPoolExecutor(max_workers=MAX_WARD_WORKERS) as executor:
            futures = [
                executor.submit(fetch_ward_results, election_id, state_name, lga_name, ward, download_files)
                for ward in wards
            ]
            for future in as_completed(futures):
                ward_rows, skipped_ward = future.result()
                rows.extend(ward_rows)
                if skipped_ward:
                    skipped_wards.append(skipped_ward)

    return rows, skipped_wards


def spool_results(election_ids, download_files: bool = True):
    ensure_dirs()
    all_rows = []
    all_skipped_wards = []

    with requests.Session() as session:
        session.trust_env = False
        session.headers.update({"User-Agent": "AfricaDataWarehouseResultSpooler/1.0"})
        for election_id in election_ids:
            rows, skipped_wards = collect_election(session, election_id, download_files=download_files)
            all_rows.extend(rows)
            all_skipped_wards.extend(skipped_wards)

    if not all_rows:
        raise ValueError("No polling-unit result rows were found.")

    df = pd.DataFrame(all_rows)
    if all_skipped_wards:
        pd.DataFrame(all_skipped_wards).to_csv(OUTPUT_DIR / "skipped_wards.csv", index=False)
        print(f"\nSkipped wards: {len(all_skipped_wards)}. See {OUTPUT_DIR / 'skipped_wards.csv'}")
    elif (OUTPUT_DIR / "skipped_wards.csv").exists():
        (OUTPUT_DIR / "skipped_wards.csv").unlink()
    return df, *write_outputs(df)


def main():
    parser = argparse.ArgumentParser(description="Download INEC PU result sheets and consolidate results.")
    parser.add_argument("--election-id", action="append", help="INEC election ID to spool. Can be repeated.")
    parser.add_argument("--discover-fct", action="store_true", default=True, help="Discover all 2026 FCT chairmanship LGA elections.")
    parser.add_argument("--election-type-id", default=DEFAULT_ELECTION_TYPE_ID, help="INEC election type ID for discovery.")
    parser.add_argument("--state-id", default=DEFAULT_STATE_ID, type=int, help="INEC state ID for discovery.")
    parser.add_argument("--date-prefix", default=DEFAULT_ELECTION_DATE_PREFIX, help="Election date prefix for discovery.")
    parser.add_argument("--no-downloads", action="store_true", help="Collect figures without downloading result sheets.")
    args = parser.parse_args()

    with requests.Session() as session:
        session.trust_env = False
        session.headers.update({"User-Agent": "AfricaDataWarehouseResultSpooler/1.0"})
        if args.election_id:
            election_ids = args.election_id
        else:
            try:
                elections = discover_elections(
                    session,
                    args.election_type_id,
                    args.state_id,
                    election_date_prefix=args.date_prefix,
                )
                election_ids = [election["_id"] for election in elections]
                print("Discovered elections:")
                for election in elections:
                    domain = election.get("domain") or {}
                    print(f"  {domain.get('name')}: {election.get('_id')}")
            except requests.RequestException as exc:
                print(f"Election discovery failed, using built-in FCT 2026 IDs: {exc}")
                election_ids = [election_id for _, election_id in FCT_2026_CHAIRMANSHIP_ELECTIONS]
                for lga_name, election_id in FCT_2026_CHAIRMANSHIP_ELECTIONS:
                    print(f"  {lga_name}: {election_id}")

    df, ward_summary, lga_summary, state_summary = spool_results(
        election_ids,
        download_files=not args.no_downloads,
    )

    print("\nDone.")
    print(f"PU rows: {len(df)}")
    print(f"Wards: {len(ward_summary)}")
    print(f"LGAs: {len(lga_summary)}")
    print(f"Excel: {EXCEL_FILE}")
    print(f"SQLite: {SQLITE_FILE}")
    print(f"CSV files: {OUTPUT_DIR}")
    print(f"Downloaded files: {DOWNLOAD_DIR}")
    print("\nState summary:")
    print(state_summary.to_string(index=False))


if __name__ == "__main__":
    main()
