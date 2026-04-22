---
name: "T1567.004_exfiltration-over-webhook"
description: "Adversaries may exfiltrate data to a webhook endpoint rather than over their primary command and control channel."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1567.004
  - exfiltration
  - windows
  - macos
  - linux
  - saas
  - office-suite
  - esxi
  - sub-technique
technique_id: "T1567.004"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - Windows
  - macOS
  - Linux
  - SaaS
  - Office Suite
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1567/004"
tech_stack:
  - windows
  - macos
  - linux
  - saas
  - office
  - esxi
cwe_ids:
  - CWE-200
chains_with:
  - T1567
  - T1567.001
  - T1567.002
  - T1567.003
prerequisites:
  - T1567
severity_boost:
  T1567: "Chain with T1567 for deeper attack path"
  T1567.001: "Chain with T1567.001 for deeper attack path"
  T1567.002: "Chain with T1567.002 for deeper attack path"
---

# T1567.004 Exfiltration Over Webhook

> **Sub-technique of:** T1567

## High-Level Description

Adversaries may exfiltrate data to a webhook endpoint rather than over their primary command and control channel. Webhooks are simple mechanisms for allowing a server to push data over HTTP/S to a client without the need for the client to continuously poll the server. Many public and commercial services, such as Discord, Slack, and `webhook.site`, support the creation of webhook endpoints that can be used by other services, such as Github, Jira, or Trello. When changes happen in the linked services (such as pushing a repository update or modifying a ticket), these services will automatically post the data to the webhook endpoint for use by the consuming application. 

Adversaries may link an adversary-owned environment to a victim-owned SaaS service to achieve repeated Automated Exfiltration of emails, chat messages, and other data. Alternatively, instead of linking the webhook endpoint to a service, an adversary can manually post staged data directly to the URL in order to exfiltrate it.

Access to webhook endpoints is often over HTTPS, which gives the adversary an additional level of protection. Exfiltration leveraging webhooks can also blend in with normal network traffic if the webhook endpoint points to a commonly used SaaS application or collaboration service.

## Kill Chain Phase

- Exfiltration (TA0010)

**Platforms:** Windows, macOS, Linux, SaaS, Office Suite, ESXi

## What to Check

- [ ] Identify if Exfiltration Over Webhook technique is applicable to target environment
- [ ] Check Windows systems for indicators of Exfiltration Over Webhook
- [ ] Check macOS systems for indicators of Exfiltration Over Webhook
- [ ] Check Linux systems for indicators of Exfiltration Over Webhook
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Exfiltration Over Webhook by examining the target platforms (Windows, macOS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1567.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1057 Data Loss Prevention
Data loss prevention can be detect and block sensitive data being uploaded to web services via web browsers.


## Detection

### Detection Strategy for Exfiltration Over Webhook


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Exfiltration Over Webhook technique applicable | Low | Exfiltration |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Checkmarx Webhooks](https://medium.com/checkmarx-security/webhook-party-malicious-packages-caught-exfiltrating-data-via-legit-webhook-services-6e046b07d191)
- [CyberArk Labs Discord](https://www.cyberark.com/resources/threat-research-blog/the-not-so-secret-war-on-discord)
- [Discord Intro to Webhooks](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks)
- [Microsoft SQL Server](https://www.microsoft.com/security/blog/2023/10/03/defending-new-vectors-threat-actors-attempt-sql-server-to-cloud-lateral-movement/)
- [Talos Discord Webhook Abuse](https://blog.talosintelligence.com/collab-app-abuse/)
- [Push Security SaaS Attacks Repository Webhooks](https://github.com/pushsecurity/saas-attacks/blob/main/techniques/webhooks/description.md)
- [RedHat Webhooks](https://www.redhat.com/en/topics/automation/what-is-a-webhook)
- [Atomic Red Team - T1567.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1567.004)
- [MITRE ATT&CK - T1567.004](https://attack.mitre.org/techniques/T1567/004)
