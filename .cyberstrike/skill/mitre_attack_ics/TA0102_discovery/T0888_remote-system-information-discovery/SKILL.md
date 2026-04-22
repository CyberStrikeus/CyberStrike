---
name: "T0888_remote-system-information-discovery"
description: "An adversary may attempt to get detailed information about remote systems and their peripherals, such as make/model, role, and configuration."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0888
  - discovery
technique_id: "T0888"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0888"
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

# T0888 Remote System Information Discovery

## High-Level Description

An adversary may attempt to get detailed information about remote systems and their peripherals, such as make/model, role, and configuration. Adversaries may use information from Remote System Information Discovery to aid in targeting and shaping follow-on behaviors. For example, the system's operational role and model information can dictate whether it is a relevant target for the adversary's operational objectives. In addition, the system's configuration may be used to scope subsequent technique usage. 

Requests for system information are typically implemented using automation and management protocols and are often automatically requested by vendor software during normal operation. This information may be used to tailor management actions, such as program download and system or module firmware. An adversary may leverage this same information by issuing calls directly to the system's API.

## Kill Chain Phase

- Discovery (TA0102)

**Platforms:** ICS

## What to Check

- [ ] Identify if Remote System Information Discovery technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Remote System Information Discovery
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Remote System Information Discovery by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0888 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0814 Static Network Configuration
ICS environments typically have more statically defined devices, therefore minimize the use of both IT discovery protocols (e.g., DHCP, LLDP) and discovery functions in automation protocols. Examples of automation protocols with discovery capabilities include OPC UA Device Discovery , BACnet , and Ethernet/IP.


## Detection

### Detection of Remote System Information Discovery


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Remote System Information Discovery technique applicable | Medium | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [MITRE ATT&CK ICS - T0888](https://attack.mitre.org/techniques/T0888)
