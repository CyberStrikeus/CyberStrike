---
name: ci-assessment
description: READ-ONLY CI/CD pipeline security assessment for GitHub Actions, dependency security, and software supply chain
category: security-assessment
tags: [cicd, github-actions, supply-chain, dependency-security, branch-protection, secrets, pipeline-security]
tech_stack: [github, gh-cli]
cwe_ids: [CWE-94, CWE-78, CWE-269, CWE-311, CWE-502, CWE-829]
chains_with: [T1195.002, T1059.004, T1552.001]
prerequisites: [gh-cli-access]
version: "1.0"
---

# CI/CD Pipeline Security Assessment

READ-ONLY CI/CD security assessment using gh CLI and local filesystem inspection. No repositories, workflows, or configurations are modified. Focused on GitHub Actions but includes dependency and supply chain checks applicable to any CI platform.

## Prerequisites

1. **gh CLI installed and authenticated** — `gh auth status`
2. **Repository access** — read access to target repository
3. **For dependency_audit** — local checkout of the repository

```bash
# Quick prerequisite check
gh auth status          # verify GitHub auth
gh repo view OWNER/REPO # verify repo access
```

## Assessment Phases

### Phase 1 — GitHub Actions Workflow Security

| Check | Command | Risk |
|-------|---------|------|
| Dangerous triggers | `ci_audit github_actions_audit --repo OWNER/REPO` | pull_request_target, workflow_dispatch injection |
| Script injection | `ci_audit github_actions_audit --repo OWNER/REPO` | ${{ github.event.* }} in run blocks |
| Token permissions | `ci_audit github_permissions_audit --repo OWNER/REPO` | Missing or overly broad GITHUB_TOKEN scope |
| Action pinning | `ci_audit github_actions_pinning_audit --repo OWNER/REPO` | Unpinned third-party actions (tag poisoning) |

### Phase 2 — Secrets & Runner Security

| Check | Command | Risk |
|-------|---------|------|
| Secret leakage | `ci_audit github_secrets_exposure_audit --repo OWNER/REPO` | Secrets in logs, env dumps, artifacts |
| Self-hosted runners | `ci_audit github_runner_audit --repo OWNER/REPO` | Runner persistence, PR-triggered execution |

### Phase 3 — Repository Security

| Check | Command | Risk |
|-------|---------|------|
| Branch protection | `ci_audit github_branch_protection_audit --repo OWNER/REPO` | Missing reviews, force push, no status checks |

### Phase 4 — Dependency & Supply Chain

| Check | Command | Risk |
|-------|---------|------|
| Dependency security | `ci_audit dependency_audit --path /path/to/repo` | Unpinned deps, no lockfile, known vulns |
| Supply chain | `ci_audit supply_chain_audit --repo OWNER/REPO --path /path` | No Dependabot, missing CODEOWNERS, hardcoded tokens |

## Detection Scope

| Category | What We Check | What We Don't |
|----------|---------------|---------------|
| **Workflows** | Triggers, injection, permissions, pinning | Runtime behavior, actual secret values |
| **Secrets** | Exposure patterns in YAML | Actual secret content or rotation status |
| **Runners** | Self-hosted presence, risky triggers | Runner OS hardening, network isolation |
| **Branch Protection** | Rule configuration | Bypass via admin override audit trail |
| **Dependencies** | Versions, lockfiles, known CVEs | Transitive dependency behavior |
| **Supply Chain** | Automation config, CODEOWNERS | SBOM completeness, SLSA compliance level |

## Program Reference

| Program | Focus | Tool |
|---------|-------|------|
| github_actions_audit | Trigger analysis, script injection | gh API |
| github_permissions_audit | GITHUB_TOKEN scope | gh API |
| github_actions_pinning_audit | SHA pinning vs tag references | gh API |
| github_secrets_exposure_audit | Secret leakage patterns | gh API |
| github_runner_audit | Self-hosted runner risks | gh API |
| github_branch_protection_audit | Protection rule analysis | gh API |
| dependency_audit | Lockfile, versions, npm audit | local + npm |
| supply_chain_audit | Dependabot, CODEOWNERS, .npmrc | gh API + local |
