#!/usr/bin/env python3
"""
cleanup_ci.py — CI/CD Pipeline Modification Rollback

Removes branches, workflow files, and other artifacts created by
CyberStrike cipipe tools.

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


class CiCleaner:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.state = load_state()
        self.cleaned = 0
        self.failed = 0

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — CI/CD Cleanup")
        print("=" * 70)
        print(f"PID:        {os.getpid()}")
        print(f"Dry-run:    {self.args.dry_run}")
        print(f"State file: {STATE_FILE}")
        print(f"Resources:  {len(self.state.get('created_resources', []))}")
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

    def delete_github_branches(self):
        if not self.running:
            return
        gh_token = self.args.github_token or os.environ.get("GITHUB_TOKEN", "")
        if not gh_token:
            return

        headers = {"Authorization": f"Bearer {gh_token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}

        branches = [r for r in self.state.get("created_resources", []) if r["type"] == "branch"]
        for resource in branches:
            if not self.running:
                break
            branch = resource["id"]
            repo = resource.get("repo", "")
            if not repo:
                continue
            if self.args.dry_run:
                self.emit({"action": "delete_branch", "status": "dry_run", "detail": f"Would delete {repo}:{branch}"})
                continue
            r = requests.delete(f"{GH_API}/repos/{repo}/git/refs/heads/{branch}", headers=headers, timeout=30)
            if r.status_code in (200, 204):
                self.cleaned += 1
                self.emit({"action": "delete_branch", "status": "success", "detail": f"Deleted {repo}:{branch}"})
            elif r.status_code == 422:
                self.emit({"action": "delete_branch", "status": "not_found", "detail": f"{branch} already deleted"})
            else:
                self.failed += 1
                self.emit({"action": "delete_branch", "status": "failed", "detail": f"HTTP {r.status_code}"})

    def delete_gitlab_branches(self):
        if not self.running:
            return
        gl_token = self.args.gitlab_token or os.environ.get("GITLAB_TOKEN", "")
        if not gl_token:
            return

        gitlab_url = self.args.gitlab_url or os.environ.get("GITLAB_URL", "https://gitlab.com")
        headers = {"Private-Token": gl_token}

        branches = [r for r in self.state.get("created_resources", []) if r["type"] == "gitlab_branch"]
        for resource in branches:
            if not self.running:
                break
            branch = resource["id"]
            project_id = resource.get("project_id", "")
            if not project_id:
                continue
            if self.args.dry_run:
                self.emit({"action": "delete_gl_branch", "status": "dry_run", "detail": f"Would delete project:{project_id} branch:{branch}"})
                continue
            r = requests.delete(f"{gitlab_url}/api/v4/projects/{project_id}/repository/branches/{branch}", headers=headers, timeout=30)
            if r.status_code in (200, 204):
                self.cleaned += 1
                self.emit({"action": "delete_gl_branch", "status": "success", "detail": f"Deleted project:{project_id} branch:{branch}"})
            elif r.status_code == 404:
                self.emit({"action": "delete_gl_branch", "status": "not_found", "detail": f"{branch} already deleted"})
            else:
                self.failed += 1
                self.emit({"action": "delete_gl_branch", "status": "failed", "detail": f"HTTP {r.status_code}"})

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        self.delete_github_branches()
        self.delete_gitlab_branches()

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
        print(f"\n--- cleanup_ci summary ---")
        print(f"Mode:    {'DRY RUN' if self.args.dry_run else 'LIVE'}")
        print(f"Cleaned: {self.cleaned}")
        print(f"Failed:  {self.failed}")
        print(f"Records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Clean up CI/CD artifacts created by CyberStrike cipipe tools.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 cleanup_ci.py --dry-run\n"
            "  python3 cleanup_ci.py --github-token $TOKEN\n"
            "  python3 cleanup_ci.py --gitlab-token $TOKEN --gitlab-url https://gitlab.example.com\n"
        ),
    )
    parser.add_argument("--dry-run", action="store_true", default=False, help="Show what would be cleaned without acting")
    parser.add_argument("--github-token", type=str, default=None, help="GitHub token for branch deletion")
    parser.add_argument("--gitlab-token", type=str, default=None, help="GitLab token for branch deletion")
    parser.add_argument("--gitlab-url", type=str, default=None, help="GitLab instance URL")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    cleaner = CiCleaner(args)
    cleaner.run()


if __name__ == "__main__":
    main()
