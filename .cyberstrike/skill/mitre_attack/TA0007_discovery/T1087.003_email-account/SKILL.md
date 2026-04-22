---
name: "T1087.003_email-account"
description: "Adversaries may attempt to get a listing of email addresses and accounts."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1087.003
  - discovery
  - windows
  - office-suite
  - sub-technique
technique_id: "T1087.003"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Windows
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1087/003"
tech_stack:
  - windows
  - office
cwe_ids:
  - CWE-200
chains_with:
  - T1087
  - T1087.001
  - T1087.002
  - T1087.004
prerequisites:
  - T1087
severity_boost:
  T1087: "Chain with T1087 for deeper attack path"
  T1087.001: "Chain with T1087.001 for deeper attack path"
  T1087.002: "Chain with T1087.002 for deeper attack path"
---

# T1087.003 Email Account

> **Sub-technique of:** T1087

## High-Level Description

Adversaries may attempt to get a listing of email addresses and accounts. Adversaries may try to dump Exchange address lists such as global address lists (GALs).

In on-premises Exchange and Exchange Online, the <code>Get-GlobalAddressList</code> PowerShell cmdlet can be used to obtain email addresses and accounts from a domain using an authenticated session.

In Google Workspace, the GAL is shared with Microsoft Outlook users through the Google Workspace Sync for Microsoft Outlook (GWSMO) service. Additionally, the Google Workspace Directory allows for users to get a listing of other users within the organization.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Windows, Office Suite

## What to Check

- [ ] Identify if Email Account technique is applicable to target environment
- [ ] Check Windows systems for indicators of Email Account
- [ ] Check Office Suite systems for indicators of Email Account
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Email Account by examining the target platforms (Windows, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1087.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Enumeration of Global Address Lists via Email Account Discovery

## Risk Assessment

| Finding                            | Severity | Impact    |
| ---------------------------------- | -------- | --------- |
| Email Account technique applicable | Low      | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Black Hills Attacking Exchange MailSniper, 2016](https://www.blackhillsinfosec.com/attacking-exchange-with-mailsniper/)
- [Google Workspace Global Access List](https://support.google.com/a/answer/166870?hl=en)
- [Microsoft Exchange Address Lists](https://docs.microsoft.com/en-us/exchange/email-addresses-and-address-books/address-lists/address-lists?view=exchserver-2019)
- [Microsoft getglobaladdresslist](https://docs.microsoft.com/en-us/powershell/module/exchange/email-addresses-and-address-books/get-globaladdresslist)
- [Atomic Red Team - T1087.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1087.003)
- [MITRE ATT&CK - T1087.003](https://attack.mitre.org/techniques/T1087/003)
