---
name: "T0848_rogue-master"
description: "Adversaries may setup a rogue master to leverage control server functions to communicate with outstations."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0848
  - initial-access
technique_id: "T0848"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0848"
tech_stack:
  - ics
cwe_ids:
  - CWE-20
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0848 Rogue Master

## High-Level Description

Adversaries may setup a rogue master to leverage control server functions to communicate with outstations. A rogue master can be used to send legitimate control messages to other control system devices, affecting processes in unintended ways. It may also be used to disrupt network communications by capturing and receiving the network traffic meant for the actual master. Impersonating a master may also allow an adversary to avoid detection. 

In the case of the 2017 Dallas Siren incident, adversaries used a rogue master to send command messages to the 156 distributed sirens across the city, either through a single rogue transmitter with a strong signal, or using many distributed repeaters.

## Kill Chain Phase

- Initial Access (TA0108)

**Platforms:** ICS

## What to Check

- [ ] Identify if Rogue Master technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Rogue Master
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Rogue Master by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0848 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0813 Software Process and Device Authentication
Devices should authenticate all messages between master and outstation assets.

### M0937 Filter Network Traffic
Perform inline allowlisting of automation protocol commands to prevent devices from sending unauthorized command or reporting messages. Allow/denylist techniques need to be designed with sufficient accuracy to prevent the unintended blocking of valid reporting messages.

### M0930 Network Segmentation
Segment operational assets and their management devices based on their functional role within the process. Enabling more strict isolation to more critical control and operational information within the control environment.

### M0807 Network Allowlists
Use host-based allowlists to prevent devices from accepting connections from unauthorized systems. For example, allowlists can be used to ensure devices can only connect with master stations or known management/engineering workstations.

### M0802 Communication Authenticity
Protocols used for control functions should provide authenticity through MAC functions or digital signatures. If not, utilize bump-in-the-wire devices or VPNs to enforce communication authenticity between devices that are not capable of supporting this (e.g., legacy controllers, RTUs).


## Detection

### Detection of Rogue Master


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Rogue Master technique applicable | Low | Initial Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [Bastille April 2017](https://www.bastille.net/blogs/2017/4/17/dallas-siren-attack)
- [Zack Whittaker April 2017](https://www.zdnet.com/article/experts-think-they-know-how-dallas-emergency-sirens-were-hacked/)
- [MITRE ATT&CK ICS - T0848](https://attack.mitre.org/techniques/T0848)
