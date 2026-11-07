---
marp: true
theme: default
paginate: true
backgroundColor: #0a0a0a
color: #e0e0e0
style: |
  section {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
  }
  h1, h2, h3 {
    color: #00ff88;
  }
  code {
    background: #1a1a2e;
    color: #00ff88;
  }
  a {
    color: #00d4ff;
  }
  table {
    font-size: 0.85em;
  }
  th {
    background: #1a1a2e;
    color: #00ff88;
  }
  td {
    background: #0d0d0d;
  }
---

# Security Agents

## Specialized AI for Security Assessment

<!-- TODO: Logo placeholder - replace with actual logo -->
<!-- ![bg right:40% 80%](../images/cyberstrike-logo.svg) -->
![bg right:40% 80%](#00ff88)

**Deep Dive into Agent Architecture**

---

# Agent Architecture

## How Agents Work

```
┌─────────────────────────────────────────┐
│              User Request               │
└───────────────────┬─────────────────────┘
                    ▼
┌─────────────────────────────────────────┐
│          Agent Selection                │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │   Web   │ │  Cloud  │ │ Network │   │
│  └────┬────┘ └────┬────┘ └────┬────┘   │
└───────┴───────────┴───────────┴─────────┘
                    ▼
┌─────────────────────────────────────────┐
│     Specialized Prompt + Tools          │
└─────────────────────────────────────────┘
```

---

# Available Agents

| Agent | Domain | Key Tools |
|-------|--------|-----------|
| `web-application` | Web security | Browser, Nuclei, SQLMap |
| `cloud-security` | Cloud infra | AWS CLI, Prowler, ScoutSuite |
| `internal-network` | Network pentest | Nmap, BloodHound, Impacket |
| `bug-hunter` | Bug bounty | Subfinder, GAU, ffuf |

---

# Web Application Agent

## OWASP-Focused Testing

### Capabilities
- OWASP Top 10 vulnerability detection
- WSTG methodology coverage
- Browser-based interactive testing
- Traffic capture and analysis
- Injection attack testing

---

# WSTG Methodology

## Web Security Testing Guide v4.2

| Category | Tests | Focus |
|----------|-------|-------|
| WSTG-INFO | 10 | Information gathering |
| WSTG-CONF | 13 | Configuration testing |
| WSTG-ATHN | 11 | Authentication testing |
| WSTG-SESS | 11 | Session management |
| WSTG-INPV | 29 | Input validation |
| WSTG-BUSL | 10 | Business logic |

---

# Browser Tool Integration

## Interactive Testing with Traffic Capture

```bash
> Launch browser and navigate to https://target.com

[Browser launched with DevTools access]
[Traffic capture enabled]

> Fill the login form with test credentials

[Captured POST /api/auth]
[Response: 401 Unauthorized]

> Check network logs for sensitive data exposure
```

---

# Web Agent Example

## SQL Injection Testing

```
$ cyberstrike --agent web-application

> Test the login form for SQL injection

[Analyzing form structure...]
[Testing: admin' OR '1'='1 --]
[Response indicates SQL error]

┌──────────────────────────────────────┐
│ FINDING: SQL Injection               │
├──────────────────────────────────────┤
│ WSTG-ID: WSTG-INPV-05               │
│ Severity: High (CVSS 8.6)           │
│ CWE: CWE-89                         │
│ Location: POST /api/login           │
│ Parameter: username                 │
└──────────────────────────────────────┘
```

---

# Cloud Security Agent

## Multi-Cloud Infrastructure Auditing

### Supported Platforms
- **AWS**: IAM, S3, EC2, Lambda, RDS
- **Azure**: AD, Blob Storage, RBAC
- **GCP**: IAM, GCS, Compute, Cloud Functions

### Frameworks
- CIS Benchmarks
- AWS Well-Architected
- Cloud Security Alliance

---

# Cloud Security Methodology

## Assessment Flow

```
┌─────────────┐
│ Enumeration │ → Identify resources
└──────┬──────┘
       ▼
┌─────────────┐
│ IAM Analysis│ → Review permissions
└──────┬──────┘
       ▼
┌─────────────┐
│ Storage     │ → Check bucket ACLs
└──────┬──────┘
       ▼
┌─────────────┐
│ Compliance  │ → CIS benchmark check
└─────────────┘
```

---

# AWS Security Checks

| Check | Description |
|-------|-------------|
| S3 Public Access | Detect publicly accessible buckets |
| IAM Over-Permissions | Identify overly permissive policies |
| EC2 Metadata | Check IMDS v1 exposure |
| Lambda Permissions | Review function execution roles |
| CloudTrail Status | Confirm audit logging |
| RDS Accessibility | Verify database isolation |

---

# Cloud Agent Example

## S3 Bucket Audit

```bash
$ cyberstrike --agent cloud-security

> Check all S3 buckets for public access

[Enumerating buckets...]
[Found 15 buckets]
[Analyzing ACLs and policies...]

┌──────────────────────────────────────┐
│ FINDING: Public S3 Bucket            │
├──────────────────────────────────────┤
│ Bucket: logs-backup-2025             │
│ Severity: Critical (CVSS 9.0)        │
│ CIS Benchmark: CIS AWS 2.1.1         │
│ Issue: AllUsers has READ access      │
│ Remediation: Enable Block Public     │
└──────────────────────────────────────┘
```

---

# Internal Network Agent

## Active Directory and Network Pentest

### Attack Vectors
- Kerberoasting
- AS-REP Roasting
- Pass-the-Hash
- NTLM Relay
- Delegation Attacks
- AD CS Exploitation

---

# Attack Path Visualization

## Privilege Escalation Paths

```
User Account
    │
    ▼ Kerberoasting
Service Account (SVC_SQL)
    │
    ▼ Lateral Movement
SQL Server (Local Admin)
    │
    ▼ Credential Dumping
Domain Admin Credentials
    │
    ▼ DCSync
Full Domain Compromise
```

---

# Network Agent Tools

| Tool | Purpose |
|------|---------|
| Nmap | Network scanning |
| BloodHound | AD relationship mapping |
| NetExec | Network exploitation |
| Kerbrute | Kerberos enumeration |
| Impacket | Protocol attacks |
| Responder | LLMNR/NBT-NS poisoning |

---

# Network Agent Example

## Kerberoasting Attack

```bash
$ cyberstrike --agent internal-network

> Perform Kerberoasting against the domain

[Querying AD for SPNs...]
[Found 5 service accounts]
[Requesting TGS tickets...]

┌──────────────────────────────────────┐
│ FINDING: Kerberoastable Account      │
├──────────────────────────────────────┤
│ Account: SVC_SQL                     │
│ SPN: MSSQLSvc/sql01.domain.local     │
│ MITRE ATT&CK: T1558.003             │
│ Hash: $krb5tgs$23$*SVC_SQL$...      │
│ [Cracking with hashcat...]          │
│ Password: Summer2025!               │
└──────────────────────────────────────┘
```

---

# Bug Hunter Agent

## Reconnaissance and Vulnerability Hunting

### Focus Areas
- Attack surface discovery
- Subdomain enumeration
- Historical data analysis
- JavaScript endpoint extraction
- Secret detection
- Vulnerability chaining

---

# Reconnaissance Flow

```
Target Domain
    │
    ├─► Subdomain Enum (subfinder, amass)
    │       └─► DNS Resolution
    │             └─► HTTP Probing (httpx)
    │                   └─► Nuclei Scan
    │
    ├─► Historical URLs (gau, wayback)
    │       └─► Parameter Discovery
    │             └─► SQLi/XSS Testing
    │
    └─► JavaScript Analysis
            └─► Endpoint Extraction
                  └─► API Testing
```

---

# Bug Hunter Tools

| Tool | Purpose |
|------|---------|
| Subfinder | Subdomain enumeration |
| Amass | OSINT reconnaissance |
| Httpx | HTTP probing |
| Nuclei | Vulnerability scanning |
| GAU | URL discovery |
| ffuf | Web fuzzing |
| LinkFinder | JS endpoint extraction |

---

# Bug Hunter Example

## Subdomain Takeover

```bash
$ cyberstrike --agent bug-hunter

> Find subdomain takeover opportunities

[Enumerating subdomains...]
[Found 127 subdomains]
[Checking CNAME records...]
[Testing for takeover...]

┌──────────────────────────────────────┐
│ FINDING: Subdomain Takeover          │
├──────────────────────────────────────┤
│ Subdomain: status.target.com         │
│ CNAME: target-status.herokuapp.com   │
│ Status: 404 (unclaimed)              │
│ Severity: High                       │
│ PoC: Register on Heroku              │
└──────────────────────────────────────┘
```

---

# Creating Custom Agents

## Agent Configuration

```markdown
---
description: API security testing specialist
model: anthropic/claude-opus-4-20250514
mode: primary
color: "#00FF88"
steps: 100
---

You are an API security specialist focusing on:
- REST API security testing
- GraphQL vulnerability assessment
- OAuth/OIDC implementation review

## Methodology
1. API discovery and documentation review
2. Authentication mechanism analysis
3. Authorization testing (BOLA, BFLA)
```

---

# Agent Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `description` | string | Agent purpose |
| `model` | string | Override AI model |
| `mode` | string | primary or subagent |
| `color` | string | UI color (#RRGGBB) |
| `steps` | number | Max iterations |
| `temperature` | number | Model temperature |
| `permission` | object | Tool permissions |

---

# Agent Switching

## Change Agents During Session

### Keyboard Shortcuts
- `Tab`: Next agent
- `Shift+Tab`: Previous agent
- `<leader>a`: Agent list

### Slash Command
```
/agent cloud-security
```

### Inline Mention
```
@web-application scan the login form
```

---

# Agent Permissions

## Per-Agent Tool Control

```json
{
  "agent": {
    "code-review": {
      "permission": {
        "read": "allow",
        "glob": "allow",
        "grep": "allow",
        "edit": "deny",
        "bash": "deny"
      }
    }
  }
}
```

---

# Best Practices

## Effective Agent Usage

1. **Select the right agent** for your task
2. **Provide clear scope** in your prompts
3. **Review findings** before proceeding
4. **Export evidence** with HAR files
5. **Document findings** in memory
6. **Chain agents** for complex assessments

---

# Agent Workflow Example

## Full Penetration Test

```bash
# Phase 1: Reconnaissance
$ cyberstrike --agent bug-hunter
> Enumerate attack surface for target.com

# Phase 2: Web Testing
$ cyberstrike --agent web-application
> Test discovered endpoints for vulnerabilities

# Phase 3: Cloud Review
$ cyberstrike --agent cloud-security
> Audit the AWS infrastructure

# Phase 4: Report Generation
$ cyberstrike --agent build
> Generate penetration test report
```

---

# Summary

## Agent Capabilities

| Agent | Strength |
|-------|----------|
| Web Application | OWASP, Browser automation |
| Cloud Security | Multi-cloud compliance |
| Internal Network | AD attacks, Lateral movement |
| Bug Hunter | Recon, Vulnerability chaining |

---

# Resources

## Learn More

- **Agents Docs**: https://cyberstrike.io/docs/agents
- **Custom Agents**: https://cyberstrike.io/docs/config
- **OWASP WSTG**: https://owasp.org/www-project-web-security-testing-guide/

---

# Thank You

## Start Testing with Agents

```bash
cyberstrike --agent web-application
```

**Questions?**

---
