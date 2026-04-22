---
name: "T1087_account-discovery"
description: "Adversaries may attempt to get a listing of valid accounts, usernames, or email addresses on a system or within a compromised environment."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1087
  - discovery
  - esxi
  - iaas
  - identity-provider
  - linux
  - macos
  - office-suite
  - saas
  - windows
technique_id: "T1087"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - ESXi
  - IaaS
  - Identity Provider
  - Linux
  - macOS
  - Office Suite
  - SaaS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1087"
tech_stack:
  - esxi
  - cloud
  - identity
  - linux
  - macos
  - office
  - saas
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1087.001
  - T1087.002
  - T1087.003
  - T1087.004
prerequisites:
  []
severity_boost:
  T1087.001: "Chain with T1087.001 for deeper attack path"
  T1087.002: "Chain with T1087.002 for deeper attack path"
  T1087.003: "Chain with T1087.003 for deeper attack path"
---

# T1087 Account Discovery

## High-Level Description

Adversaries may attempt to get a listing of valid accounts, usernames, or email addresses on a system or within a compromised environment. This information can help adversaries determine which accounts exist, which can aid in follow-on behavior such as brute-forcing, spear-phishing attacks, or account takeovers (e.g., Valid Accounts).

Adversaries may use several methods to enumerate accounts, including abuse of existing tools, built-in commands, and potential misconfigurations that leak account names and roles or permissions in the targeted environment.

For examples, cloud environments typically provide easily accessible interfaces to obtain user lists. On hosts, adversaries can use default PowerShell and other command line functionality to identify accounts. Information about email addresses and accounts may also be extracted by searching an infected system’s files.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** ESXi, IaaS, Identity Provider, Linux, macOS, Office Suite, SaaS, Windows

## What to Check

- [ ] Identify if Account Discovery technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Account Discovery
- [ ] Check IaaS systems for indicators of Account Discovery
- [ ] Check Identity Provider systems for indicators of Account Discovery
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Account Discovery by examining the target platforms (ESXi, IaaS, Identity Provider).

2. **Assess Existing Defenses**: Review whether mitigations for T1087 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1028 Operating System Configuration
Prevent administrator accounts from being enumerated when an application is elevating through UAC since it can lead to the disclosure of account names. The Registry key is located <code>HKLM\ SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\CredUI\EnumerateAdministrators</code>. It can be disabled through GPO: Computer Configuration > [Policies] > Administrative Templates > Windows Components > Credential User Interface: E numerate administrator accounts on elevation.

### M1018 User Account Management
Manage the creation, modification, use, and permissions associated to user accounts.


## Detection

### Enumeration of User or Account Information Across Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Account Discovery technique applicable | High | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [AWS List Users](https://docs.aws.amazon.com/cli/latest/reference/iam/list-users.html)
- [Google Cloud - IAM Servie Accounts List API](https://cloud.google.com/sdk/gcloud/reference/iam/service-accounts/list)
- [Elastic - Koadiac Detection with EQL](https://www.elastic.co/security-labs/embracing-offensive-tooling-building-detections-against-koadic-using-eql)
- [Atomic Red Team - T1087](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1087)
- [MITRE ATT&CK - T1087](https://attack.mitre.org/techniques/T1087)
