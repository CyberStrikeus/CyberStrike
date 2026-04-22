---
name: "T1586.003_cloud-accounts"
description: "Adversaries may compromise cloud accounts that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1586.003
  - resource-development
  - pre
  - sub-technique
technique_id: "T1586.003"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1586/003"
tech_stack:
  - pre
cwe_ids: []
chains_with:
  - T1586
  - T1586.001
  - T1586.002
prerequisites:
  - T1586
severity_boost:
  T1586: "Chain with T1586 for deeper attack path"
  T1586.001: "Chain with T1586.001 for deeper attack path"
  T1586.002: "Chain with T1586.002 for deeper attack path"
---

# T1586.003 Cloud Accounts

> **Sub-technique of:** T1586

## High-Level Description

Adversaries may compromise cloud accounts that can be used during targeting. Adversaries can use compromised cloud accounts to further their operations, including leveraging cloud storage services such as Dropbox, Microsoft OneDrive, or AWS S3 buckets for Exfiltration to Cloud Storage or to Upload Tools. Cloud accounts can also be used in the acquisition of infrastructure, such as Virtual Private Servers or Serverless infrastructure. Additionally, cloud-based messaging services such as Twilio, SendGrid, AWS End User Messaging, AWS SNS (Simple Notification Service), or AWS SES (Simple Email Service) may be leveraged for spam or Phishing. Compromising cloud accounts may allow adversaries to develop sophisticated capabilities without managing their own servers.

A variety of methods exist for compromising cloud accounts, such as gathering credentials via Phishing for Information, purchasing credentials from third-party sites, conducting Password Spraying attacks, or attempting to Steal Application Access Tokens. Prior to compromising cloud accounts, adversaries may conduct Reconnaissance to inform decisions about which accounts to compromise to further their operation. In some cases, adversaries may target privileged service provider accounts with the intent of leveraging a Trusted Relationship between service providers and their customers.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Cloud Accounts technique is applicable to target environment
- [ ] Check PRE systems for indicators of Cloud Accounts
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cloud Accounts by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1586.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.

## Detection

### Detection of Cloud Accounts

## Risk Assessment

| Finding                             | Severity | Impact               |
| ----------------------------------- | -------- | -------------------- |
| Cloud Accounts technique applicable | High     | Resource Development |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [Palo Alto Unit 42 Compromised Cloud Compute Credentials 2022](https://unit42.paloaltonetworks.com/compromised-cloud-compute-credentials/)
- [Awake Security C2 Cloud](https://awakesecurity.com/blog/threat-hunting-series-detecting-command-control-in-the-cloud/)
- [Netcraft SendGrid 2024](https://www.netcraft.com/blog/popular-email-platform-used-to-impersonate-itself/)
- [MSTIC Nobelium Oct 2021](https://www.microsoft.com/security/blog/2021/10/25/nobelium-targeting-delegated-administrative-privileges-to-facilitate-broader-attacks/)
- [Atomic Red Team - T1586.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1586.003)
- [MITRE ATT&CK - T1586.003](https://attack.mitre.org/techniques/T1586/003)
