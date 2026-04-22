---
name: "T1585.002_email-accounts"
description: "Adversaries may create email accounts that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1585.002
  - resource-development
  - pre
  - sub-technique
technique_id: "T1585.002"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1585/002"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1585
  - T1585.001
  - T1585.003
prerequisites:
  - T1585
severity_boost:
  T1585: "Chain with T1585 for deeper attack path"
  T1585.001: "Chain with T1585.001 for deeper attack path"
  T1585.003: "Chain with T1585.003 for deeper attack path"
---

# T1585.002 Email Accounts

> **Sub-technique of:** T1585

## High-Level Description

Adversaries may create email accounts that can be used during targeting. Adversaries can use accounts created with email providers to further their operations, such as leveraging them to conduct Phishing for Information or Phishing. Establishing email accounts may also allow adversaries to abuse free services – such as trial periods – to Acquire Infrastructure for follow-on purposes.

Adversaries may also take steps to cultivate a persona around the email account, such as through use of Social Media Accounts, to increase the chance of success of follow-on behaviors. Created email accounts can also be used in the acquisition of infrastructure (ex: Domains).

To decrease the chance of physically tying back operations to themselves, adversaries may make use of disposable email services.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Email Accounts technique is applicable to target environment
- [ ] Check PRE systems for indicators of Email Accounts
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Email Accounts by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1585.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Email Accounts


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Email Accounts technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [Trend Micro R980 2016](https://blog.trendmicro.com/trendlabs-security-intelligence/r980-ransomware-disposable-email-service/)
- [Free Trial PurpleUrchin](https://unit42.paloaltonetworks.com/purpleurchin-steals-cloud-resources/)
- [Mandiant APT1](https://www.fireeye.com/content/dam/fireeye-www/services/pdfs/mandiant-apt1-report.pdf)
- [Atomic Red Team - T1585.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1585.002)
- [MITRE ATT&CK - T1585.002](https://attack.mitre.org/techniques/T1585/002)
