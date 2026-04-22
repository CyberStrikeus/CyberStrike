---
name: "T0855_unauthorized-command-message"
description: "Adversaries may send unauthorized command messages to instruct control system assets to perform actions outside of their intended functionality, or without the logical preconditions to trigger thei..."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0855
  - impair-process-control
technique_id: "T0855"
tactic: "impair-process-control"
all_tactics:
  - impair-process-control
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0855"
tech_stack:
  - ics
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0855 Unauthorized Command Message

## High-Level Description

Adversaries may send unauthorized command messages to instruct control system assets to perform actions outside of their intended functionality, or without the logical preconditions to trigger their expected function. Command messages are used in ICS networks to give direct instructions to control systems devices. If an adversary can send an unauthorized command message to a control system, then it can instruct the control systems device to perform an action outside the normal bounds of the device's actions. An adversary could potentially instruct a control systems device to perform an action that will cause an Impact.

In the Dallas Siren incident, adversaries were able to send command messages to activate tornado alarm systems across the city without an impending tornado or other disaster.

## Kill Chain Phase

- Impair Process Control (TA0106)

**Platforms:** ICS

## What to Check

- [ ] Identify if Unauthorized Command Message technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Unauthorized Command Message
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Unauthorized Command Message by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0855 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0818 Validate Program Inputs

Devices and programs that receive command messages from remote systems (e.g., control servers) should verify those commands before taking any actions on them.

### M0930 Network Segmentation

Segment operational assets and their management devices based on their functional role within the process. Enabling more strict isolation to more critical control and operational information within the control environment.

### M0937 Filter Network Traffic

Perform inline allowlisting of automation protocol commands to prevent devices from sending unauthorized command or reporting messages. Allow/denylist techniques need to be designed with sufficient accuracy to prevent the unintended blocking of valid messages.

### M0802 Communication Authenticity

Protocols used for control functions should provide authenticity through MAC functions or digital signatures. If not, utilize bump-in-the-wire devices or VPNs to enforce communication authenticity between devices that are not capable of supporting this (e.g., legacy controllers, RTUs).

### M0807 Network Allowlists

Use host-based allowlists to prevent devices from accepting connections from unauthorized systems. For example, allowlists can be used to ensure devices can only connect with master stations or known management/engineering workstations.

### M0813 Software Process and Device Authentication

Devices should authenticate all messages between master and outstation assets.

## Detection

### Detection of Unauthorized Command Message

## Risk Assessment

| Finding                                           | Severity | Impact                 |
| ------------------------------------------------- | -------- | ---------------------- |
| Unauthorized Command Message technique applicable | Low      | Impair Process Control |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [Benjamin Freed March 2019](https://statescoop.com/tornado-sirens-in-dallas-suburbs-deactivated-after-being-hacked-and-set-off/)
- [Bonnie Zhu, Anthony Joseph, Shankar Sastry 2011](http://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=6142258)
- [Zack Whittaker April 2017](https://www.zdnet.com/article/experts-think-they-know-how-dallas-emergency-sirens-were-hacked/)
- [MITRE ATT&CK ICS - T0855](https://attack.mitre.org/techniques/T0855)
