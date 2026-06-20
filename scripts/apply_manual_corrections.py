import argparse
import sqlite3
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from full_results_downloader import make_summary, numeric_party_columns
from live_state_spooler import add_upload_count_columns, normalize_numeric_columns


CORE_COLUMNS = [
    "Ballots Issued",
    "Ballots Used",
    "Invalid Votes",
    "Total Accredited",
    "Total Registered",
    "Valid Votes",
]


def read_existing_upload_counts(out_dir: Path):
    lga_path = out_dir / "lga_summary.csv"
    ward_path = out_dir / "ward_summary.csv"
    state_path = out_dir / "state_summary.csv"
    counts = {"lga": {}, "ward": {}, "state_uploaded": None, "state_expected": None}

    def to_int(value):
        parsed = pd.to_numeric(value, errors="coerce")
        return int(parsed) if pd.notna(parsed) else 0

    if lga_path.exists():
        lga_df = pd.read_csv(lga_path)
        if "INEC Uploaded Results" in lga_df.columns:
            counts["lga"] = {
                str(row["LGA"]): to_int(row["INEC Uploaded Results"])
                for _, row in lga_df.iterrows()
            }

    if ward_path.exists():
        ward_df = pd.read_csv(ward_path)
        if "INEC Uploaded Results" in ward_df.columns:
            counts["ward"] = {
                (str(row["LGA"]), str(row["Ward"])): to_int(row["INEC Uploaded Results"])
                for _, row in ward_df.iterrows()
            }

    if state_path.exists():
        state_df = pd.read_csv(state_path)
        if not state_df.empty and "INEC Uploaded Results" in state_df.columns:
            counts["state_uploaded"] = to_int(state_df["INEC Uploaded Results"].iloc[0])
        if not state_df.empty and "INEC Expected Results" in state_df.columns:
            counts["state_expected"] = to_int(state_df["INEC Expected Results"].iloc[0])

    return counts


def apply_corrections(state_name: str, corrections_path: Path) -> None:
    out_dir = Path("output") / state_name
    pu_path = out_dir / "pu_results.csv"
    if not pu_path.exists():
        raise FileNotFoundError(f"Missing PU results file: {pu_path}")

    df = pd.read_csv(pu_path)
    corrections = pd.read_csv(corrections_path)
    corrections = corrections[corrections["State"].str.casefold() == state_name.casefold()]
    if corrections.empty:
        raise ValueError(f"No corrections found for state {state_name}")

    party_columns = numeric_party_columns(df)
    update_columns = [col for col in [*CORE_COLUMNS, *party_columns] if col in corrections.columns]

    for _, correction in corrections.iterrows():
        pu_code = str(correction["PU Code"])
        matches = df["PU Code"].astype(str) == pu_code
        if matches.sum() != 1:
            raise ValueError(f"Expected exactly one row for PU Code {pu_code}, found {matches.sum()}")

        for col in update_columns:
            value = pd.to_numeric(correction[col], errors="coerce")
            if pd.notna(value):
                df.loc[matches, col] = int(value)

        note = str(correction.get("Notes", "") or "").strip()
        if note:
            existing = str(df.loc[matches, "Result Info PU"].iloc[0] or "").strip()
            df.loc[matches, "Result Info PU"] = f"{existing} | Manual correction: {note}".strip(" |")

    df = normalize_numeric_columns(df)
    sort_columns = [col for col in ["State", "LGA", "Ward", "PU Code", "Polling Unit", "PU ID"] if col in df.columns]
    if sort_columns:
        df = df.sort_values(sort_columns, kind="stable").reset_index(drop=True)

    ward_summary = make_summary(df, ["State", "LGA", "Ward"])
    lga_summary = make_summary(df, ["State", "LGA"])
    state_summary = make_summary(df, ["State"])
    add_upload_count_columns(ward_summary, lga_summary, state_summary, read_existing_upload_counts(out_dir))

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


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply audited manual result-sheet corrections.")
    parser.add_argument("--state", required=True)
    parser.add_argument("--corrections", required=True, type=Path)
    args = parser.parse_args()
    apply_corrections(args.state, args.corrections)


if __name__ == "__main__":
    main()
