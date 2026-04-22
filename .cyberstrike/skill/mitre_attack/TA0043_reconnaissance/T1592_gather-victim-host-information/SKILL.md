---
name: "T1592_gather-victim-host-information"
description: "Adversaries may gather information about the victim's hosts that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1592
  - reconnaissance
  - pre
technique_id: "T1592"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1592"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1592.001
  - T1592.002
  - T1592.003
  - T1592.004
prerequisites:
  []
severity_boost:
  T1592.001: "Chain with T1592.001 for deeper attack path"
  T1592.002: "Chain with T1592.002 for deeper attack path"
  T1592.003: "Chain with T1592.003 for deeper attack path"
---

# T1592 Gather Victim Host Information

## High-Level Description

Adversaries may gather information about the victim's hosts that can be used during targeting. Information about hosts may include a variety of details, including administrative data (ex: name, assigned IP, functionality, etc.) as well as specifics regarding its configuration (ex: operating system, language, etc.).

Adversaries may gather this information in various ways, such as direct collection actions via Active Scanning or Phishing for Information. Adversaries may also compromise sites then include malicious content designed to collect host information from visitors. Information about hosts may also be exposed to adversaries via online or other accessible data sets (ex: Social Media or Search Victim-Owned Websites). Gathering this information may reveal opportunities for other forms of reconnaissance (ex: Search Open Websites/Domains or Search Open Technical Databases), establishing operational resources (ex: Develop Capabilities or Obtain Capabilities), and/or initial access (ex: Supply Chain Compromise or External Remote Services).

Adversaries may also gather victim host information via User-Agent HTTP headers, which are sent to a server to identify the application, operating system, vendor, and/or version of the requesting user agent. This can be used to inform the adversary’s follow-on action. For example, adversaries may check user agents for the requesting operating system, then only serve malware for target operating systems while ignoring others.

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Gather Victim Host Information technique is applicable to target environment
- [ ] Check PRE systems for indicators of Gather Victim Host Information
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Gather Victim Host Information by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1592 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.


## Detection

### Detection of Gather Victim Host Information


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Gather Victim Host Information technique applicable | High | Reconnaissance |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [ATT ScanBox](https://cybersecurity.att.com/blogs/labs-research/scanbox-a-reconnaissance-framework-used-on-watering-hole-attacks)
- [TrellixQakbot](https://www.trellix.com/blogs/research/qakbot-evolves-to-onenote-malware-distribution/)
- [ThreatConnect Infrastructure Dec 2020](https://threatconnect.com/blog/infrastructure-research-hunting/)
- [Atomic Red Team - T1592](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1592)
- [MITRE ATT&CK - T1592](https://attack.mitre.org/techniques/T1592)
