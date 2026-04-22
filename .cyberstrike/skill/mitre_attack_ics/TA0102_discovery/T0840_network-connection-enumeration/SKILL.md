---
name: "T0840_network-connection-enumeration"
description: "Adversaries may perform network connection enumeration to discover information about device communication patterns."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0840
  - discovery
technique_id: "T0840"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0840"
tech_stack:
  - ics
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0840 Network Connection Enumeration

## High-Level Description

Adversaries may perform network connection enumeration to discover information about device communication patterns. If an adversary can inspect the state of a network connection with tools, such as Netstat, in conjunction with System Firmware, then they can determine the role of certain devices on the network . The adversary can also use Network Sniffing to watch network traffic for details about the source, destination, protocol, and content.

## Kill Chain Phase

- Discovery (TA0102)

**Platforms:** ICS

## What to Check

- [ ] Identify if Network Connection Enumeration technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Network Connection Enumeration
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Network Connection Enumeration by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0840 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0816 Mitigation Limited or Not Effective
Network connection enumeration is likely obtained by using common system tools (e.g., netstat, ipconfig).


## Detection

### Detection of Network Connection Enumeration


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Network Connection Enumeration technique applicable | Low | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [MITRE](https://attack.mitre.org/wiki/Technique/T1049)
- [Netstat](https://en.wikipedia.org/wiki/Netstat)
- [MITRE ATT&CK ICS - T0840](https://attack.mitre.org/techniques/T0840)
