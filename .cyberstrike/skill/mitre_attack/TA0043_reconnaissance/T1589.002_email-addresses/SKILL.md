---
name: "T1589.002_email-addresses"
description: "Adversaries may gather email addresses that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1589.002
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1589.002"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1589/002"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1589
  - T1589.001
  - T1589.003
prerequisites:
  - T1589
severity_boost:
  T1589: "Chain with T1589 for deeper attack path"
  T1589.001: "Chain with T1589.001 for deeper attack path"
  T1589.003: "Chain with T1589.003 for deeper attack path"
---

# T1589.002 Email Addresses

> **Sub-technique of:** T1589

## High-Level Description

Adversaries may gather email addresses that can be used during targeting. Even if internal instances exist, organizations may have public-facing email infrastructure and addresses for employees.

Adversaries may easily gather email addresses, since they may be readily available and exposed via online or other accessible data sets (ex: Social Media or Search Victim-Owned Websites). Email addresses could also be enumerated via more active means (i.e. Active Scanning), such as probing and analyzing responses from authentication services that may reveal valid usernames in a system. For example, adversaries may be able to enumerate email addresses in Office 365 environments by querying a variety of publicly available API endpoints, such as autodiscover and GetCredentialType.

Gathering this information may reveal opportunities for other forms of reconnaissance (ex: Search Open Websites/Domains or Phishing for Information), establishing operational resources (ex: Email Accounts), and/or initial access (ex: Phishing or Brute Force via External Remote Services).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Email Addresses technique is applicable to target environment
- [ ] Check PRE systems for indicators of Email Addresses
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Email Addresses by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1589.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.

## Detection

### Detection of Email Addresses

## Risk Assessment

| Finding                              | Severity | Impact         |
| ------------------------------------ | -------- | -------------- |
| Email Addresses technique applicable | High     | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Azure Active Directory Reconnaisance](https://o365blog.com/post/just-looking/)
- [GitHub Office 365 User Enumeration](https://github.com/gremwell/o365enum)
- [GrimBlog UsernameEnum](https://grimhacker.com/2017/07/24/office365-activesync-username-enumeration/)
- [HackersArise Email](https://www.hackers-arise.com/email-scraping-and-maltego)
- [CNET Leaks](https://www.cnet.com/news/massive-breach-leaks-773-million-emails-21-million-passwords/)
- [Atomic Red Team - T1589.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1589.002)
- [MITRE ATT&CK - T1589.002](https://attack.mitre.org/techniques/T1589/002)
