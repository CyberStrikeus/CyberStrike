---
name: "T1059.008_network-device-cli"
description: "Adversaries may abuse scripting or built-in command line interpreters (CLI) on network devices to execute malicious command and payloads."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1059.008
  - execution
  - network-devices
  - sub-technique
technique_id: "T1059.008"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1059/008"
tech_stack:
  - network devices
cwe_ids:
  - CWE-94
chains_with:
  - T1059
  - T1059.001
  - T1059.002
  - T1059.003
  - T1059.004
  - T1059.005
  - T1059.006
  - T1059.007
  - T1059.009
  - T1059.010
  - T1059.011
  - T1059.012
  - T1059.013
prerequisites:
  - T1059
severity_boost:
  T1059: "Chain with T1059 for deeper attack path"
  T1059.001: "Chain with T1059.001 for deeper attack path"
  T1059.002: "Chain with T1059.002 for deeper attack path"
---

# T1059.008 Network Device CLI

> **Sub-technique of:** T1059

## High-Level Description

Adversaries may abuse scripting or built-in command line interpreters (CLI) on network devices to execute malicious command and payloads. The CLI is the primary means through which users and administrators interact with the device in order to view system information, modify device operations, or perform diagnostic and administrative functions. CLIs typically contain various permission levels required for different commands. 

Scripting interpreters automate tasks and extend functionality beyond the command set included in the network OS. The CLI and scripting interpreter are accessible through a direct console connection, or through remote means, such as telnet or SSH.

Adversaries can use the network CLI to change how network devices behave and operate. The CLI may be used to manipulate traffic flows to intercept or manipulate data, modify startup configuration parameters to load malicious system software, or to disable security features or logging to avoid detection.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Network Devices

## What to Check

- [ ] Identify if Network Device CLI technique is applicable to target environment
- [ ] Check Network Devices systems for indicators of Network Device CLI
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Network Device CLI by examining the target platforms (Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1059.008 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1038 Execution Prevention
TACACS+ can keep control over which commands administrators are permitted to use through the configuration of authentication and command authorization.

### M1026 Privileged Account Management
Use of Authentication, Authorization, and Accounting (AAA) systems will limit actions administrators can perform and provide a history of user actions to detect unauthorized use and abuse. TACACS+ can keep control over which commands administrators are permitted to use through the configuration of authentication and command authorization

### M1018 User Account Management
Use of Authentication, Authorization, and Accounting (AAA) systems will limit actions users can perform and provide a history of user actions to detect unauthorized use and abuse. Ensure least privilege principles are applied to user accounts and groups so that only authorized users can perform configuration changes.


## Detection

### Behavioral Detection of CLI Abuse on Network Devices


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Network Device CLI technique applicable | Low | Execution |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-94 | Improper Control of Generation of Code |


## References

- [Cisco IOS Software Integrity Assurance - Command History](https://tools.cisco.com/security/center/resources/integrity_assurance.html#23)
- [Cisco Synful Knock Evolution](https://blogs.cisco.com/security/evolution-of-attacks-on-cisco-ios-devices)
- [Atomic Red Team - T1059.008](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1059.008)
- [MITRE ATT&CK - T1059.008](https://attack.mitre.org/techniques/T1059/008)
