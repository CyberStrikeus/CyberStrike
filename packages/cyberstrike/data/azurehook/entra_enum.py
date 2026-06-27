#!/usr/bin/env python3
"""
entra_enum.py — Entra ID (Azure AD) Tenant Enumeration

Enumerates users, groups, applications, service principals, and
conditional access policies via Microsoft Graph API.

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

GRAPH_BASE = "https://graph.microsoft.com/v1.0"


class EntraEnumerator:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.token = args.token or os.environ.get("AZURE_ACCESS_TOKEN", "")

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — Entra ID Enumeration")
        print("=" * 70)
        print(f"PID:       {os.getpid()}")
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
            rtype = record.get("type", "info")
            name = record.get("name", "unknown")
            detail = record.get("detail", "")
            print(f"[{rtype.upper():<12}] {name:<50} {detail}", flush=True)

    def headers(self):
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    def graph_get(self, endpoint, params=None):
        url = f"{GRAPH_BASE}{endpoint}"
        results = []
        while url and self.running:
            r = requests.get(url, headers=self.headers(), params=params, timeout=30)
            if r.status_code != 200:
                self.emit({"type": "error", "name": endpoint, "detail": f"HTTP {r.status_code}: {r.text[:200]}"})
                break
            data = r.json()
            results.extend(data.get("value", []))
            url = data.get("@odata.nextLink")
            params = None
        return results

    def enum_me(self):
        if not self.running:
            return
        r = requests.get(f"{GRAPH_BASE}/me", headers=self.headers(), timeout=30)
        if r.status_code == 200:
            me = r.json()
            self.emit({
                "type": "identity",
                "name": me.get("userPrincipalName", me.get("displayName", "unknown")),
                "detail": f"id={me.get('id')} mail={me.get('mail')}",
                "id": me.get("id"),
                "display_name": me.get("displayName"),
                "upn": me.get("userPrincipalName"),
                "mail": me.get("mail"),
                "job_title": me.get("jobTitle"),
            })
        else:
            self.emit({"type": "error", "name": "/me", "detail": f"HTTP {r.status_code}"})

    def enum_users(self):
        if not self.running:
            return
        users = self.graph_get("/users", params={"$select": "id,displayName,userPrincipalName,mail,accountEnabled,userType,createdDateTime"})
        for user in users:
            if not self.running:
                break
            self.emit({
                "type": "user",
                "name": user.get("userPrincipalName", user.get("displayName", "unknown")),
                "detail": f"enabled={user.get('accountEnabled')} type={user.get('userType')}",
                "id": user.get("id"),
                "display_name": user.get("displayName"),
                "upn": user.get("userPrincipalName"),
                "mail": user.get("mail"),
                "account_enabled": user.get("accountEnabled"),
                "user_type": user.get("userType"),
                "created": user.get("createdDateTime"),
            })

    def enum_groups(self):
        if not self.running:
            return
        groups = self.graph_get("/groups", params={"$select": "id,displayName,description,groupTypes,securityEnabled,mailEnabled"})
        for group in groups:
            if not self.running:
                break
            self.emit({
                "type": "group",
                "name": group.get("displayName", "unknown"),
                "detail": f"security={group.get('securityEnabled')} types={group.get('groupTypes', [])}",
                "id": group.get("id"),
                "display_name": group.get("displayName"),
                "description": group.get("description"),
                "security_enabled": group.get("securityEnabled"),
                "mail_enabled": group.get("mailEnabled"),
                "group_types": group.get("groupTypes", []),
            })

    def enum_applications(self):
        if not self.running:
            return
        apps = self.graph_get("/applications", params={"$select": "id,displayName,appId,signInAudience,createdDateTime"})
        for app in apps:
            if not self.running:
                break
            self.emit({
                "type": "application",
                "name": app.get("displayName", "unknown"),
                "detail": f"appId={app.get('appId')} audience={app.get('signInAudience')}",
                "id": app.get("id"),
                "display_name": app.get("displayName"),
                "app_id": app.get("appId"),
                "sign_in_audience": app.get("signInAudience"),
                "created": app.get("createdDateTime"),
            })

    def enum_service_principals(self):
        if not self.running:
            return
        sps = self.graph_get("/servicePrincipals", params={"$select": "id,displayName,appId,servicePrincipalType,accountEnabled"})
        for sp in sps:
            if not self.running:
                break
            self.emit({
                "type": "sp",
                "name": sp.get("displayName", "unknown"),
                "detail": f"type={sp.get('servicePrincipalType')} enabled={sp.get('accountEnabled')} appId={sp.get('appId')}",
                "id": sp.get("id"),
                "display_name": sp.get("displayName"),
                "app_id": sp.get("appId"),
                "sp_type": sp.get("servicePrincipalType"),
                "account_enabled": sp.get("accountEnabled"),
            })

    def enum_directory_roles(self):
        if not self.running:
            return
        roles = self.graph_get("/directoryRoles")
        for role in roles:
            if not self.running:
                break
            members = self.graph_get(f"/directoryRoles/{role['id']}/members")
            member_names = [m.get("displayName", m.get("id", "unknown")) for m in members]
            self.emit({
                "type": "dir_role",
                "name": role.get("displayName", "unknown"),
                "detail": f"members={len(member_names)}",
                "id": role.get("id"),
                "display_name": role.get("displayName"),
                "description": role.get("description"),
                "members": member_names,
                "member_count": len(member_names),
            })

    def run(self):
        self.print_banner()

        if not self.token:
            print("ERROR: Access token required. Set --token or AZURE_ACCESS_TOKEN env var.", file=sys.stderr)
            sys.exit(1)

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        self.enum_me()
        self.enum_users()
        self.enum_groups()
        self.enum_applications()
        self.enum_service_principals()
        self.enum_directory_roles()

        self.cleanup()

    def cleanup(self):
        print(f"\n--- entra_enum summary ---")
        print(f"Total records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Enumerate Entra ID (Azure AD) tenant: users, groups, apps, service principals, roles.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 entra_enum.py --token $AZURE_TOKEN\n"
            "  AZURE_ACCESS_TOKEN=$TOKEN python3 entra_enum.py --json-output\n"
        ),
    )
    parser.add_argument("--token", type=str, default=None, help="Azure AD access token (or set AZURE_ACCESS_TOKEN)")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    enumerator = EntraEnumerator(args)
    enumerator.run()


if __name__ == "__main__":
    main()
