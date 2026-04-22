---
name: "T1590.001_domain-properties"
description: "Adversaries may gather information about the victim's network domain(s) that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1590.001
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1590.001"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1590/001"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1590
  - T1590.002
  - T1590.003
  - T1590.004
  - T1590.005
  - T1590.006
prerequisites:
  - T1590
severity_boost:
  T1590: "Chain with T1590 for deeper attack path"
  T1590.002: "Chain with T1590.002 for deeper attack path"
  T1590.003: "Chain with T1590.003 for deeper attack path"
---

# T1590.001 Domain Properties

> **Sub-technique of:** T1590

## High-Level Description

Adversaries may gather information about the victim's network domain(s) that can be used during targeting. Information about domains and their properties may include a variety of details, including what domain(s) the victim owns as well as administrative data (ex: name, registrar, etc.) and more directly actionable information such as contacts (email addresses and phone numbers), business addresses, and name servers.

Adversaries may gather this information in various ways, such as direct collection actions via Active Scanning or Phishing for Information. Information about victim domains and their properties may also be exposed to adversaries via online or other accessible data sets (ex: WHOIS). Where third-party cloud providers are in use, this information may also be exposed through publicly available API endpoints, such as GetUserRealm and autodiscover in Office 365 environments. Gathering this information may reveal opportunities for other forms of reconnaissance (ex: Search Open Technical Databases, Search Open Websites/Domains, or Phishing for Information), establishing operational resources (ex: Acquire Infrastructure or Compromise Infrastructure), and/or initial access (ex: Phishing).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Domain Properties technique is applicable to target environment
- [ ] Check PRE systems for indicators of Domain Properties
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Domain Properties by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1590.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.

## Detection

### Detection of Domain Properties

## Risk Assessment

| Finding                                | Severity | Impact         |
| -------------------------------------- | -------- | -------------- |
| Domain Properties technique applicable | High     | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Circl Passive DNS](https://www.circl.lu/services/passive-dns/)
- [Azure Active Directory Reconnaisance](https://o365blog.com/post/just-looking/)
- [DNS Dumpster](https://dnsdumpster.com/)
- [Office 265 Azure Domain Availability](https://docs.microsoft.com/en-us/archive/blogs/tip_of_the_day/cloud-tip-of-the-day-advanced-way-to-check-domain-availability-for-office-365-and-azure)
- [WHOIS](https://who.is/)
- [Atomic Red Team - T1590.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1590.001)
- [MITRE ATT&CK - T1590.001](https://attack.mitre.org/techniques/T1590/001)
