#!/usr/bin/env python3
"""GitHub intelligence dorker — search for leaked secrets using gh CLI."""
import argparse
import subprocess
import json
import sys

DORK_PATTERNS = [
    "password", "passwd", "pwd",
    "api_key", "apikey", "api-key",
    "secret", "secret_key", "secretkey",
    "token", "access_token", "auth_token",
    "private_key", "PRIVATE KEY",
    "credential", "credentials",
    "database_url", "db_password", "db_host",
    "aws_access_key", "aws_secret", "AKIA",
    "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
    "smtp_password", "mail_password",
    "client_secret", "client_id",
    "slack_token", "slack_webhook",
    "firebase", "firebaseConfig",
    "mongodb://", "postgres://", "mysql://", "redis://",
    "staging", "internal", "localhost",
    ".env", "dotenv",
]

def search_code(org, pattern, repo=None):
    cmd = ["gh", "search", "code", pattern]
    if repo:
        cmd.extend(["--repo", repo])
    else:
        cmd.extend(["--owner", org])
    cmd.extend(["--json", "path,repository,textFragment", "--limit", "10"])
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout)
        return []
    except:
        return []

def list_org_repos(org):
    try:
        result = subprocess.run(
            ["gh", "api", f"/orgs/{org}/repos", "--paginate", "--jq", ".[].full_name"],
            capture_output=True, text=True, timeout=30)
        return [r.strip() for r in result.stdout.strip().split("\n") if r.strip()]
    except:
        return []

def search_commits(org, keywords):
    results = []
    for keyword in keywords:
        try:
            cmd = ["gh", "search", "commits", keyword, "--owner", org,
                   "--json", "sha,repository,commit", "--limit", "5"]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if result.returncode == 0 and result.stdout.strip():
                commits = json.loads(result.stdout)
                for c in commits:
                    msg = c.get("commit", {}).get("message", "")[:100]
                    results.append({"keyword": keyword, "repo": c.get("repository", {}).get("fullName", ""),
                                    "sha": c.get("sha", "")[:12], "message": msg})
        except:
            pass
    return results

def main():
    parser = argparse.ArgumentParser(description="GitHub intelligence dorker")
    parser.add_argument("org", help="GitHub organization name")
    parser.add_argument("--repo", default=None, help="Specific repo (org/repo)")
    parser.add_argument("--patterns", nargs="+", default=None, help="Custom search patterns")
    parser.add_argument("--json-output", action="store_true")
    parser.add_argument("--commits", action="store_true", help="Also search commit messages")
    args = parser.parse_args()

    patterns = args.patterns or DORK_PATTERNS
    all_findings = []

    print(f"\nGitHub Intelligence: {args.org}")
    print(f"{'='*60}\n")

    if not args.repo:
        repos = list_org_repos(args.org)
        print(f"[*] Found {len(repos)} public repos\n")

    for pattern in patterns:
        results = search_code(args.org, pattern, args.repo)
        if results:
            print(f"  [FOUND] '{pattern}' — {len(results)} matches:")
            for r in results[:3]:
                repo = r.get("repository", {}).get("fullName", "unknown")
                path = r.get("path", "unknown")
                fragment = r.get("textFragment", "")[:100].replace("\n", " ")
                print(f"          {repo}/{path}: {fragment}")
                all_findings.append({"pattern": pattern, "repo": repo, "path": path, "fragment": fragment})

    if args.commits:
        print(f"\n[*] Searching commit messages...")
        commit_keywords = ["remove secret", "fix security", "delete key", "remove password",
                           "patch vulnerability", "remove token", "fix leak"]
        commits = search_commits(args.org, commit_keywords)
        if commits:
            print(f"  [FOUND] {len(commits)} interesting commits:")
            for c in commits:
                print(f"          [{c['sha']}] {c['repo']}: {c['message']}")
            all_findings.extend(commits)

    print(f"\n{'='*60}")
    print(f"Total findings: {len(all_findings)}")

    if args.json_output:
        print(json.dumps({"org": args.org, "findings": all_findings}, indent=2))

if __name__ == "__main__":
    main()
