---
name: "T1663_remote-access-software"
description: "Adversaries may use legitimate remote access software, such as `VNC`, `TeamViewer`, `AirDroid`, `AirMirror`, etc., to establish an interactive command and control channel to target mobile devices."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1663
  - command-and-control
  - android
  - ios
technique_id: "T1663"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1663"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-300
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1663 Remote Access Software

## High-Level Description

Adversaries may use legitimate remote access software, such as `VNC`, `TeamViewer`, `AirDroid`, `AirMirror`, etc., to establish an interactive command and control channel to target mobile devices. 

Remote access applications may be installed and used post-compromise as an alternate communication channel for redundant access or as a way to establish an interactive remote session with the target device. They may also be used as a component of malware to establish a reverse connection to an adversary-controlled system or service. Installation of remote access tools may also include persistence.

## Kill Chain Phase

- Command and Control (TA0037)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Remote Access Software technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Remote Access Software
- [ ] Check iOS devices for indicators of Remote Access Software
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Remote Access Software by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1663 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1012 Enterprise Policy
When devices are enrolled in an EMM/MDM using device owner (iOS) or fully managed (Android) mode, the EMM/MDM can collect a list of installed applications on the device. An administrator can then act on, for example blocking, specific remote access applications from being installed on managed devices.

### M1011 User Guidance
Users should be encouraged to be very careful with granting dangerous permissions, such as device administrator or access to device accessibility.


## Detection

### Detection of Remote Access Software


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Remote Access Software technique applicable | Low | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [MITRE ATT&CK Mobile - T1663](https://attack.mitre.org/techniques/T1663)
