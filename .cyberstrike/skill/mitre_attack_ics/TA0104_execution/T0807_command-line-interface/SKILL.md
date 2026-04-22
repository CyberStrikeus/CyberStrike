---
name: "T0807_command-line-interface"
description: "Adversaries may utilize command-line interfaces (CLIs) to interact with systems and execute commands."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0807
  - execution
technique_id: "T0807"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0807"
tech_stack:
  - ics
cwe_ids:
  - CWE-94
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0807 Command-Line Interface

## High-Level Description

Adversaries may utilize command-line interfaces (CLIs) to interact with systems and execute commands. CLIs provide a means of interacting with computer systems and are a common feature across many types of platforms and devices within control systems environments. Adversaries may also use CLIs to install and run new software, including malicious tools that may be installed over the course of an operation.

CLIs are typically accessed locally, but can also be exposed via services, such as SSH, Telnet, and RDP. Commands that are executed in the CLI execute with the current permissions level of the process running the terminal emulator, unless the command specifies a change in permissions context. Many controllers have CLI interfaces for management purposes.

## Kill Chain Phase

- Execution (TA0104)

**Platforms:** ICS

## What to Check

- [ ] Identify if Command-Line Interface technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Command-Line Interface
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Command-Line Interface by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0807 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0938 Execution Prevention
Execution prevention may block malicious software from accessing protected resources through the command line interface.

### M0942 Disable or Remove Feature or Program
Consider removing or restricting features that are unnecessary to an asset's intended function within the control environment.


## Detection

### Detection of Command-Line Interface


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Command-Line Interface technique applicable | Low | Execution |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-94 | Improper Control of Generation of Code |


## References

- [Enterprise ATT&CK January 2018](https://attack.mitre.org/wiki/Technique/T1059)
- [MITRE ATT&CK ICS - T0807](https://attack.mitre.org/techniques/T0807)
