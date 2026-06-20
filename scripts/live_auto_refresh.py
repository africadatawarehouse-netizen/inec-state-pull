import argparse
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ekiti_refresh_status import record_status
from live_state_spooler import spool_state_once


LIVE_FEEDS = [
    ("Ekiti", "https://inecelectionresults.ng/elections/6a35bb87b4e45d80b33a6e38"),
    ("Enugu", "https://inecelectionresults.ng/elections/6a35c53958f677851b78ac96"),
    ("Kano", "https://inecelectionresults.ng/elections/6a35c3e587b1768452f7b027"),
    ("Kebbi", "https://inecelectionresults.ng/elections/6a35d6ee52574004bac51620"),
    ("Nasarawa", "https://inecelectionresults.ng/elections/6a35c6ef0a25e5860383aa57"),
    ("Ondo", "https://inecelectionresults.ng/elections/6a35c845f42f4600b2634026"),
    ("Rivers", "https://inecelectionresults.ng/elections/6a35ca5181ddfe01b36faefd"),
]

PUBLISH_PATHS = [
    "dashboard",
    *[f"output/{state}" for state, _ in LIVE_FEEDS],
]


def run(command):
    resolved = command.copy()
    if os.name == "nt" and resolved[0] in {"npm", "npx"}:
        resolved[0] = shutil.which(f"{resolved[0]}.cmd") or f"{resolved[0]}.cmd"
    print(f"$ {' '.join(command)}", flush=True)
    subprocess.run(resolved, check=True)


def has_changes():
    result = subprocess.run(["git", "diff", "--quiet", "--", *PUBLISH_PATHS])
    return result.returncode != 0


def publish_changes():
    run(["git", "add", *PUBLISH_PATHS])
    staged = subprocess.run(["git", "diff", "--cached", "--quiet"])
    if staged.returncode == 0:
        print("No staged live output changes to publish.", flush=True)
        return False

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    run(["git", "commit", "-m", f"Auto-refresh live election results {timestamp}"])
    run(["git", "push"])
    run(["npx", "vercel", "--prod", "--yes"])
    return True


def refresh_once():
    for state, url in LIVE_FEEDS:
        try:
            print(f"\n=== Refreshing {state} ===", flush=True)
            spool_state_once(state, url)
            record_status(state)
        except Exception as exc:
            print(f"WARNING: {state} refresh failed: {exc}", flush=True)

    if not has_changes():
        print("No INEC output changes detected.", flush=True)
        return False

    print("INEC output changes detected; publishing dashboard update.", flush=True)
    return publish_changes()


def main():
    parser = argparse.ArgumentParser(description="Auto-refresh live INEC feeds and publish changed dashboard output.")
    parser.add_argument("--interval", type=int, default=600, help="Seconds between INEC pulls.")
    parser.add_argument("--stop-after-idle-hours", type=float, default=10, help="Stop after this many hours with no published changes.")
    parser.add_argument("--once", action="store_true", help="Run one pull/publish cycle and exit.")
    args = parser.parse_args()

    idle_limit = timedelta(hours=args.stop_after_idle_hours)
    last_change_at = datetime.now()

    while True:
        cycle_started_at = datetime.now()
        print(f"\nLive refresh cycle started: {cycle_started_at.isoformat(timespec='seconds')}", flush=True)
        changed = refresh_once()
        if changed:
            last_change_at = datetime.now()

        if args.once:
            break

        idle_for = datetime.now() - last_change_at
        if idle_for >= idle_limit:
            print(f"No fresh INEC update for {idle_for}. Stopping live refresh loop.", flush=True)
            break

        print(f"Sleeping {args.interval} seconds before next INEC pull.", flush=True)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
