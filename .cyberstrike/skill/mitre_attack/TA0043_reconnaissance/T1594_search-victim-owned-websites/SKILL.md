---
name: "T1594_search-victim-owned-websites"
description: "Adversaries may search websites owned by the victim for information that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1594
  - reconnaissance
  - pre
technique_id: "T1594"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1594"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1594 Search Victim-Owned Websites

## High-Level Description

Adversaries may search websites owned by the victim for information that can be used during targeting. Victim-owned websites may contain a variety of details, including names of departments/divisions, physical locations, and data about key employees such as names, roles, and contact info (ex: Email Addresses). These sites may also have details highlighting business operations and relationships.

Adversaries may search victim-owned websites to gather actionable information. Information from these sources may reveal opportunities for other forms of reconnaissance (ex: Phishing for Information or Search Open Technical Databases), establishing operational resources (ex: Establish Accounts or Compromise Accounts), and/or initial access (ex: Trusted Relationship or Phishing).

In addition to manually browsing the website, adversaries may attempt to identify hidden directories or files that could contain additional sensitive information or vulnerable functionality. They may do this through automated activities such as Wordlist Scanning, as well as by leveraging files such as sitemap.xml and robots.txt.

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Search Victim-Owned Websites technique is applicable to target environment
- [ ] Check PRE systems for indicators of Search Victim-Owned Websites
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Search Victim-Owned Websites by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1594 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.


## Detection

### Detection of Search Victim-Owned Websites


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Search Victim-Owned Websites technique applicable | High | Reconnaissance |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Perez Sitemap XML 2023](https://medium.com/@adimenia/how-attackers-can-misuse-sitemaps-to-enumerate-users-and-discover-sensitive-information-361a5065857a)
- [Comparitech Leak](https://www.comparitech.com/blog/vpn-privacy/350-million-customer-records-exposed-online/)
- [Register Robots TXT 2015](https://www.theregister.com/2015/05/19/robotstxt/)
- [Atomic Red Team - T1594](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1594)
- [MITRE ATT&CK - T1594](https://attack.mitre.org/techniques/T1594)
