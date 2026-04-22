---
name: "T1596_search-open-technical-databases"
description: "Adversaries may search freely available technical databases for information about victims that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1596
  - reconnaissance
  - pre
technique_id: "T1596"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1596"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1596.001
  - T1596.002
  - T1596.003
  - T1596.004
  - T1596.005
prerequisites:
  []
severity_boost:
  T1596.001: "Chain with T1596.001 for deeper attack path"
  T1596.002: "Chain with T1596.002 for deeper attack path"
  T1596.003: "Chain with T1596.003 for deeper attack path"
---

# T1596 Search Open Technical Databases

## High-Level Description

Adversaries may search freely available technical databases for information about victims that can be used during targeting. Information about victims may be available in online databases and repositories, such as registrations of domains/certificates as well as public collections of network data/artifacts gathered from traffic and/or scans.

Adversaries may search in different open databases depending on what information they seek to gather. Information from these sources may reveal opportunities for other forms of reconnaissance (ex: Phishing for Information or Search Open Websites/Domains), establishing operational resources (ex: Acquire Infrastructure or Compromise Infrastructure), and/or initial access (ex: External Remote Services or Trusted Relationship).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Search Open Technical Databases technique is applicable to target environment
- [ ] Check PRE systems for indicators of Search Open Technical Databases
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Search Open Technical Databases by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1596 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.


## Detection

### Detection of Search Open Technical Databases


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Search Open Technical Databases technique applicable | High | Reconnaissance |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Circl Passive DNS](https://www.circl.lu/services/passive-dns/)
- [DNS Dumpster](https://dnsdumpster.com/)
- [Medium SSL Cert](https://medium.com/@menakajain/export-download-ssl-certificate-from-server-site-url-bcfc41ea46a2)
- [WHOIS](https://who.is/)
- [Shodan](https://shodan.io)
- [SSLShopper Lookup](https://www.sslshopper.com/ssl-checker.html)
- [DigitalShadows CDN](https://www.digitalshadows.com/blog-and-research/content-delivery-networks-cdns-can-leave-you-exposed-how-you-might-be-affected-and-what-you-can-do-about-it/)
- [Atomic Red Team - T1596](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1596)
- [MITRE ATT&CK - T1596](https://attack.mitre.org/techniques/T1596)
