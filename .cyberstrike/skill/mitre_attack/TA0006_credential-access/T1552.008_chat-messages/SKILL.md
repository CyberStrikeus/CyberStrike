---
name: "T1552.008_chat-messages"
description: "Adversaries may directly collect unsecured credentials stored or passed through user communication services."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1552.008
  - credential-access
  - saas
  - office-suite
  - sub-technique
technique_id: "T1552.008"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - SaaS
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1552/008"
tech_stack:
  - saas
  - office
cwe_ids:
  - CWE-522
chains_with:
  - T1552
  - T1552.001
  - T1552.002
  - T1552.003
  - T1552.004
  - T1552.005
  - T1552.006
  - T1552.007
prerequisites:
  - T1552
severity_boost:
  T1552: "Chain with T1552 for deeper attack path"
  T1552.001: "Chain with T1552.001 for deeper attack path"
  T1552.002: "Chain with T1552.002 for deeper attack path"
---

# T1552.008 Chat Messages

> **Sub-technique of:** T1552

## High-Level Description

Adversaries may directly collect unsecured credentials stored or passed through user communication services. Credentials may be sent and stored in user chat communication applications such as email, chat services like Slack or Teams, collaboration tools like Jira or Trello, and any other services that support user communication. Users may share various forms of credentials (such as usernames and passwords, API keys, or authentication tokens) on private or public corporate internal communications channels.

Rather than accessing the stored chat logs (i.e., Credentials In Files), adversaries may directly access credentials within these services on the user endpoint, through servers hosting the services, or through administrator portals for cloud hosted services. Adversaries may also compromise integration tools like Slack Workflows to automatically search through messages to extract user credentials. These credentials may then be abused to perform follow-on activities such as lateral movement or privilege escalation .

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** SaaS, Office Suite

## What to Check

- [ ] Identify if Chat Messages technique is applicable to target environment
- [ ] Check SaaS systems for indicators of Chat Messages
- [ ] Check Office Suite systems for indicators of Chat Messages
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Chat Messages by examining the target platforms (SaaS, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1552.008 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1047 Audit
Preemptively search through communication services to find shared unsecured credentials. Searching for common patterns like "<code>password is </code>", “<code>password=</code>” and take actions to reduce exposure when found.

### M1017 User Training
Ensure that developers and system administrators are aware of the risk associated with sharing unsecured passwords across communication services.


## Detection

### Detect Unsecured Credentials Shared in Chat Messages


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Chat Messages technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [Slack Security Risks](https://www.nightfall.ai/blog/saas-slack-security-risks-2020)
- [Atomic Red Team - T1552.008](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1552.008)
- [MITRE ATT&CK - T1552.008](https://attack.mitre.org/techniques/T1552/008)
