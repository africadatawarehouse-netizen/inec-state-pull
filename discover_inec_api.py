import re

import requests


URL = "https://inecelectionresults.ng/elections/types/5f129a04df41d910dcdc1d55?state_id=15"
BASE = "https://inecelectionresults.ng/"
API_BASE = "https://dolphin-app-sleqh.ondigitalocean.app/api/v1"
FCT_STATE_ID = 15
CHAIRMANSHIP_TYPE_ID = "5f129a04df41d910dcdc1d55"


def main():
    response = requests.get(URL, timeout=60)
    response.raise_for_status()
    scripts = re.findall(r'src="([^"]+\.js)"', response.text)
    print(f"Found {len(scripts)} script bundle(s)")
    for script in scripts:
        print(script)

    print("\nInteresting strings from bundles:")
    for script in scripts:
        script_url = script if script.startswith("http") else BASE + script.lstrip("/")
        bundle = requests.get(script_url, timeout=60).text
        matches = sorted(
            set(
                re.findall(
                    r'[\w:/?.=&-]*(?:dolphin-app|api/v1|elections|state_id|election_type)[\w:/?.=&-]*',
                    bundle,
                )
            )
        )
        if matches:
            print(f"\n{script}")
            for match in matches[:200]:
                print(match)

        if script.startswith("main."):
            print("\nContext snippets:")
            for needle in ["/elections", "election_type:this.electionTypeId", "state_id:e.value"]:
                index = bundle.find(needle)
                if index >= 0:
                    start = max(index - 500, 0)
                    end = min(index + 700, len(bundle))
                    print(f"\n--- {needle} ---")
                    print(bundle[start:end])

    print("\nFCT Chairmanship elections:")
    elections = requests.get(
        f"{API_BASE}/elections",
        params={"election_type": CHAIRMANSHIP_TYPE_ID, "state_id": FCT_STATE_ID},
        timeout=60,
    ).json()["data"]
    for election in elections:
        domain = election.get("domain") or {}
        print(f"{domain.get('name')}: {election.get('_id')} election_id={election.get('election_id')}")


if __name__ == "__main__":
    main()
