---
name: "T1592.001_hardware"
description: "Adversaries may gather information about the victim's host hardware that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1592.001
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1592.001"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1592/001"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1592
  - T1592.002
  - T1592.003
  - T1592.004
prerequisites:
  - T1592
severity_boost:
  T1592: "Chain with T1592 for deeper attack path"
  T1592.002: "Chain with T1592.002 for deeper attack path"
  T1592.003: "Chain with T1592.003 for deeper attack path"
---

# T1592.001 Hardware

> **Sub-technique of:** T1592

## High-Level Description

Adversaries may gather information about the victim's host hardware that can be used during targeting. Information about hardware infrastructure may include a variety of details such as types and versions on specific hosts, as well as the presence of additional components that might be indicative of added defensive protections (ex: card/biometric readers, dedicated encryption hardware, etc.).

Adversaries may gather this information in various ways, such as direct collection actions via Active Scanning (ex: hostnames, server banners, user agent strings) or Phishing for Information. Adversaries may also compromise sites then include malicious content designed to collect host information from visitors. Information about the hardware infrastructure may also be exposed to adversaries via online or other accessible data sets (ex: job postings, network maps, assessment reports, resumes, or purchase invoices). Gathering this information may reveal opportunities for other forms of reconnaissance (ex: Search Open Websites/Domains or Search Open Technical Databases), establishing operational resources (ex: Develop Capabilities or Obtain Capabilities), and/or initial access (ex: Compromise Hardware Supply Chain or Hardware Additions).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Hardware technique is applicable to target environment
- [ ] Check PRE systems for indicators of Hardware
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Hardware by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1592.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.


## Detection

### Detection of Hardware


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Hardware technique applicable | High | Reconnaissance |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [ATT ScanBox](https://cybersecurity.att.com/blogs/labs-research/scanbox-a-reconnaissance-framework-used-on-watering-hole-attacks)
- [ThreatConnect Infrastructure Dec 2020](https://threatconnect.com/blog/infrastructure-research-hunting/)
- [Atomic Red Team - T1592.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1592.001)
- [MITRE ATT&CK - T1592.001](https://attack.mitre.org/techniques/T1592/001)
