---
name: "T0823_graphical-user-interface"
description: "Adversaries may attempt to gain access to a machine via a Graphical User Interface (GUI) to enhance execution capabilities."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0823
  - execution
technique_id: "T0823"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0823"
tech_stack:
  - ics
cwe_ids:
  - CWE-94
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0823 Graphical User Interface

## High-Level Description

Adversaries may attempt to gain access to a machine via a Graphical User Interface (GUI) to enhance execution capabilities. Access to a GUI allows a user to interact with a computer in a more visual manner than a CLI. A GUI allows users to move a cursor and click on interface objects, with a mouse and keyboard as the main input devices, as opposed to just using the keyboard.

If physical access is not an option, then access might be possible via protocols such as VNC on Linux-based and Unix-based operating systems, and RDP on Windows operating systems. An adversary can use this access to execute programs and applications on the target machine.

## Kill Chain Phase

- Execution (TA0104)

**Platforms:** ICS

## What to Check

- [ ] Identify if Graphical User Interface technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Graphical User Interface
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Graphical User Interface by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0823 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0816 Mitigation Limited or Not Effective

Once an adversary has access to a remote GUI they can abuse system features, such as required HMI functions.

## Detection

### Detection of Graphical User Interface

## Risk Assessment

| Finding                                       | Severity | Impact    |
| --------------------------------------------- | -------- | --------- |
| Graphical User Interface technique applicable | Low      | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [MITRE ATT&CK ICS - T0823](https://attack.mitre.org/techniques/T0823)
