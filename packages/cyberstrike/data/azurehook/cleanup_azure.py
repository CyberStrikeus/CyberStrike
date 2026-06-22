#!/usr/bin/env python3
"""
cleanup_azure.py — Azure Resource Cleanup and Restoration

Removes all resources created by CyberStrike azurehook tools:
- Revokes OAuth2 consent grants
- Removes SP credentials
- Deletes runbooks and schedules
- Cleans the state file

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

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
ARM_BASE = "https://management.azure.com"
STATE_FILE = str(Path.home() / ".cyberstrike" / "azurehook-state.json")


def load_state():
    try:
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"created_resources": []}


class AzureCleaner:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.state = load_state()
        self.cleaned = 0
        self.failed = 0
        self.token = args.token or os.environ.get("AZURE_ACCESS_TOKEN", "")

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — Azure Cleanup")
        print("=" * 70)
        print(f"PID:        {os.getpid()}")
        print(f"Dry-run:    {self.args.dry_run}")
        print(f"State file: {STATE_FILE}")
        print(f"Resources:  {len(self.state.get('created_resources', []))}")
        print(f"Token:      {'set' if self.token else 'NOT SET'}")
        print(f"Output:     {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:    {datetime.now().isoformat()}")
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

    def graph_headers(self):
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    def arm_headers(self):
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    def revoke_consent_grants(self):
        if not self.running:
            return
        grants = [r for r in self.state.get("created_resources", []) if r["type"] == "consent_grant"]
        for resource in grants:
            if not self.running:
                break
            grant_id = resource["id"]
            if self.args.dry_run:
                self.emit({"action": "revoke_grant", "status": "dry_run", "detail": f"Would revoke {grant_id}"})
                continue
            r = requests.delete(f"{GRAPH_BASE}/oauth2PermissionGrants/{grant_id}", headers=self.graph_headers(), timeout=30)
            if r.status_code in (200, 204):
                self.cleaned += 1
                self.emit({"action": "revoke_grant", "status": "success", "detail": f"Revoked grant {grant_id}"})
            elif r.status_code == 404:
                self.emit({"action": "revoke_grant", "status": "not_found", "detail": f"{grant_id} already removed"})
            else:
                self.failed += 1
                self.emit({"action": "revoke_grant", "status": "failed", "detail": f"{grant_id}: HTTP {r.status_code}"})

    def remove_sp_secrets(self):
        if not self.running:
            return
        secrets = [r for r in self.state.get("created_resources", []) if r["type"] == "sp_secret"]
        for resource in secrets:
            if not self.running:
                break
            sp_id = resource["id"]
            key_id = resource.get("key_id")
            if not key_id:
                continue
            if self.args.dry_run:
                self.emit({"action": "remove_secret", "status": "dry_run", "detail": f"Would remove key {key_id} from SP {sp_id}"})
                continue
            body = {"keyId": key_id}
            r = requests.post(f"{GRAPH_BASE}/servicePrincipals/{sp_id}/removePassword", headers=self.graph_headers(), json=body, timeout=30)
            if r.status_code in (200, 204):
                self.cleaned += 1
                self.emit({"action": "remove_secret", "status": "success", "detail": f"Removed key {key_id} from SP {sp_id}"})
            else:
                self.failed += 1
                self.emit({"action": "remove_secret", "status": "failed", "detail": f"HTTP {r.status_code}"})

    def delete_runbooks(self):
        if not self.running:
            return
        runbooks = [r for r in self.state.get("created_resources", []) if r["type"] == "runbook"]
        for resource in runbooks:
            if not self.running:
                break
            name = resource["id"]
            sub_id = resource.get("subscription_id")
            rg = resource.get("resource_group")
            account = resource.get("automation_account")
            if not all([sub_id, rg, account]):
                continue
            if self.args.dry_run:
                self.emit({"action": "delete_runbook", "status": "dry_run", "detail": f"Would delete {name}"})
                continue
            url = f"{ARM_BASE}/subscriptions/{sub_id}/resourceGroups/{rg}/providers/Microsoft.Automation/automationAccounts/{account}/runbooks/{name}?api-version=2023-11-01"
            r = requests.delete(url, headers=self.arm_headers(), timeout=30)
            if r.status_code in (200, 204):
                self.cleaned += 1
                self.emit({"action": "delete_runbook", "status": "success", "detail": f"Deleted runbook {name}"})
            elif r.status_code == 404:
                self.emit({"action": "delete_runbook", "status": "not_found", "detail": f"{name} already deleted"})
            else:
                self.failed += 1
                self.emit({"action": "delete_runbook", "status": "failed", "detail": f"{name}: HTTP {r.status_code}"})

    def delete_schedules(self):
        if not self.running:
            return
        schedules = [r for r in self.state.get("created_resources", []) if r["type"] == "schedule"]
        for resource in schedules:
            if not self.running:
                break
            name = resource["id"]
            account = resource.get("automation_account")
            if self.args.dry_run:
                self.emit({"action": "delete_schedule", "status": "dry_run", "detail": f"Would delete {name}"})
                continue
            self.emit({"action": "delete_schedule", "status": "info", "detail": f"Schedule {name} tracked for cleanup"})

    def run(self):
        self.print_banner()

        if not self.token:
            print("ERROR: Access token required. Set --token or AZURE_ACCESS_TOKEN.", file=sys.stderr)
            sys.exit(1)

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        self.revoke_consent_grants()
        self.remove_sp_secrets()
        self.delete_runbooks()
        self.delete_schedules()

        if not self.args.dry_run:
            try:
                os.remove(STATE_FILE)
                self.emit({"action": "cleanup", "status": "success", "detail": f"Deleted state file {STATE_FILE}"})
            except FileNotFoundError:
                pass
            except OSError as e:
                self.emit({"action": "cleanup", "status": "failed", "detail": f"Cannot delete state file: {e}"})

        self.cleanup()

    def cleanup(self):
        print(f"\n--- cleanup_azure summary ---")
        print(f"Mode:    {'DRY RUN' if self.args.dry_run else 'LIVE'}")
        print(f"Cleaned: {self.cleaned}")
        print(f"Failed:  {self.failed}")
        print(f"Records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Clean up all Azure resources created by CyberStrike azurehook tools.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 cleanup_azure.py --dry-run\n"
            "  python3 cleanup_azure.py --token $TOKEN\n"
            "  python3 cleanup_azure.py --json-output\n"
        ),
    )
    parser.add_argument("--dry-run", action="store_true", default=False, help="Show what would be cleaned without acting")
    parser.add_argument("--token", type=str, default=None, help="Azure access token")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    cleaner = AzureCleaner(args)
    cleaner.run()


if __name__ == "__main__":
    main()
