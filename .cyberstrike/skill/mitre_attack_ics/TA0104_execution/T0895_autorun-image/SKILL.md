---
name: "T0895_autorun-image"
description: "Adversaries may leverage AutoRun functionality or scripts to execute malicious code."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0895
  - execution
technique_id: "T0895"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0895"
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

# T0895 Autorun Image

## High-Level Description

Adversaries may leverage AutoRun functionality or scripts to execute malicious code. Devices configured to enable AutoRun functionality or legacy operating systems may be susceptible to abuse of these features to run malicious code stored on various forms of removeable media (i.e., USB, Disk Images [.ISO]). Commonly, AutoRun or AutoPlay are disabled in many operating systems configurations to mitigate against this technique. If a device is configured to enable AutoRun or AutoPlay, adversaries may execute code on the device by mounting the removable media to the device, either through physical or virtual means. This may be especially relevant for virtual machine environments where disk images may be dynamically mapped to a guest system on a hypervisor. 

An example could include an adversary gaining access to a hypervisor through the management interface to modify a virtual machine’s hardware configuration. They could then deploy an iso image with a malicious AutoRun script to cause the virtual machine to automatically execute the code contained on the disk image. This would enable the execution of malicious code within a virtual machine without needing any prior remote access to that system.

## Kill Chain Phase

- Execution (TA0104)

**Platforms:** ICS

## What to Check

- [ ] Identify if Autorun Image technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Autorun Image
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Autorun Image by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0895 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0928 Operating System Configuration
Configure operating systems to disable the autorun of any specific file types or drives.


## Detection

### Detection of Autorun Image


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Autorun Image technique applicable | Low | Execution |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-94 | Improper Control of Generation of Code |


## References

- [MITRE ATT&CK ICS - T0895](https://attack.mitre.org/techniques/T0895)
