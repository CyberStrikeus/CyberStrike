---
name: "T1114.002_remote-email-collection"
description: "Adversaries may target an Exchange server, Office 365, or Google Workspace to collect sensitive information."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1114.002
  - collection
  - windows
  - office-suite
  - sub-technique
technique_id: "T1114.002"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Windows
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1114/002"
tech_stack:
  - windows
  - office
cwe_ids:
  - CWE-200
chains_with:
  - T1114
  - T1114.001
  - T1114.003
prerequisites:
  - T1114
severity_boost:
  T1114: "Chain with T1114 for deeper attack path"
  T1114.001: "Chain with T1114.001 for deeper attack path"
  T1114.003: "Chain with T1114.003 for deeper attack path"
---

# T1114.002 Remote Email Collection

> **Sub-technique of:** T1114

## High-Level Description

Adversaries may target an Exchange server, Office 365, or Google Workspace to collect sensitive information. Adversaries may leverage a user's credentials and interact directly with the Exchange server to acquire information from within a network. Adversaries may also access externally facing Exchange services, Office 365, or Google Workspace to access email using credentials or access tokens. Tools such as MailSniper can be used to automate searches for specific keywords.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Windows, Office Suite

## What to Check

- [ ] Identify if Remote Email Collection technique is applicable to target environment
- [ ] Check Windows systems for indicators of Remote Email Collection
- [ ] Check Office Suite systems for indicators of Remote Email Collection
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Remote Email Collection by examining the target platforms (Windows, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1114.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1060 Out-of-Band Communications Channel

Use secure out-of-band authentication methods to verify the authenticity of critical actions initiated via email, such as password resets, financial transactions, or access requests.

For highly sensitive information, utilize out-of-band communication channels instead of relying solely on email. This reduces the risk of sensitive data being collected through compromised email accounts.

Set up out-of-band alerts to notify security teams of unusual email activities, such as mass forwarding or large attachments being sent, which could indicate email collection attempts.

Create plans for leveraging a secure out-of-band communications channel, rather than an existing in-network email server, in case of a security incident.

### M1041 Encrypt Sensitive Information

Use of encryption provides an added layer of security to sensitive information sent over email. Encryption using public key cryptography requires the adversary to obtain the private certificate along with an encryption key to decrypt messages.

### M1032 Multi-factor Authentication

Use of multi-factor authentication for public-facing webmail servers is a recommended best practice to minimize the usefulness of usernames and passwords to adversaries.

## Detection

### Detect Remote Email Collection via Abnormal Login and Programmatic Access

## Risk Assessment

| Finding                                      | Severity | Impact     |
| -------------------------------------------- | -------- | ---------- |
| Remote Email Collection technique applicable | High     | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Atomic Red Team - T1114.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1114.002)
- [MITRE ATT&CK - T1114.002](https://attack.mitre.org/techniques/T1114/002)
