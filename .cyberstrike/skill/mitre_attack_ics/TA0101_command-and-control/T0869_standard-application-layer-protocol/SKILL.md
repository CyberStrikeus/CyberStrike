---
name: "T0869_standard-application-layer-protocol"
description: "Adversaries may establish command and control capabilities over commonly used application layer protocols such as HTTP(S), OPC, RDP, telnet, DNP3, and modbus."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0869
  - command-and-control
technique_id: "T0869"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0869"
tech_stack:
  - ics
cwe_ids:
  - CWE-300
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0869 Standard Application Layer Protocol

## High-Level Description

Adversaries may establish command and control capabilities over commonly used application layer protocols such as HTTP(S), OPC, RDP, telnet, DNP3, and modbus. These protocols may be used to disguise adversary actions as benign network traffic. Standard protocols may be seen on their associated port or in some cases over a non-standard port. Adversaries may use these protocols to reach out of the network for command and control, or in some cases to other infected devices within the network.

## Kill Chain Phase

- Command and Control (TA0101)

**Platforms:** ICS

## What to Check

- [ ] Identify if Standard Application Layer Protocol technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Standard Application Layer Protocol
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Standard Application Layer Protocol by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0869 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0930 Network Segmentation
Ensure proper network segmentation between higher level corporate resources and the control process environment.

### M0931 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level.

### M0807 Network Allowlists
Network allowlists can be implemented through either host-based files or system host files to specify what external connections (e.g., IP address, MAC address, port, protocol) can be made from a device. Allowlist techniques that operate at the application layer (e.g., DNP3, Modbus, HTTP) are addressed in the Filter Network Traffic mitigation.


## Detection

### Detection of Standard Application Layer Protocol


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Standard Application Layer Protocol technique applicable | Low | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [MITRE ATT&CK ICS - T0869](https://attack.mitre.org/techniques/T0869)
