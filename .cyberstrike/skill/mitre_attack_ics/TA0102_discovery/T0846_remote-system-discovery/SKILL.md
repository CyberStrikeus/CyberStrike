---
name: "T0846_remote-system-discovery"
description: "Adversaries may attempt to get a listing of other systems by IP address, hostname, or other logical identifier on a network that may be used for subsequent Lateral Movement or Discovery techniques."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0846
  - discovery
technique_id: "T0846"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0846"
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

# T0846 Remote System Discovery

## High-Level Description

Adversaries may attempt to get a listing of other systems by IP address, hostname, or other logical identifier on a network that may be used for subsequent Lateral Movement or Discovery techniques. Functionality could exist within adversary tools to enable this, but utilities available on the operating system or vendor software could also be used.

## Kill Chain Phase

- Discovery (TA0102)

**Platforms:** ICS

## What to Check

- [ ] Identify if Remote System Discovery technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Remote System Discovery
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Remote System Discovery by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0846 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0814 Static Network Configuration
ICS environments typically have more statically defined devices, therefore minimize the use of both IT discovery protocols (e.g., DHCP, LLDP) and discovery functions in automation protocols. Examples of automation protocols with discovery capabilities include OPC UA Device Discovery , BACnet , and Ethernet/IP.


## Detection

### Detection of Remote System Discovery


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Remote System Discovery technique applicable | Medium | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Enterprise ATT&CK January 2018](https://attack.mitre.org/wiki/Technique/T1018)
- [MITRE ATT&CK ICS - T0846](https://attack.mitre.org/techniques/T0846)
