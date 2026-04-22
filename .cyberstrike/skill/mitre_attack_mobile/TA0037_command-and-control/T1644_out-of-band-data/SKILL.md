---
name: "T1644_out-of-band-data"
description: "Adversaries may communicate with compromised devices using out of band data streams."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1644
  - command-and-control
  - android
  - ios
technique_id: "T1644"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1644"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-300
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1644 Out of Band Data

## High-Level Description

Adversaries may communicate with compromised devices using out of band data streams. This could be done for a variety of reasons, including evading network traffic monitoring, as a backup method of command and control, or for data exfiltration if the device is not connected to any Internet-providing networks (i.e. cellular or Wi-Fi). Several out of band data streams exist, such as SMS messages, NFC, and Bluetooth.

On Android, applications can read push notifications to capture content from SMS messages, or other out of band data streams. This requires that the user manually grant notification access to the application via the settings menu. However, the application could launch an Intent to take the user directly there.

On iOS, there is no way to programmatically read push notifications.

## Kill Chain Phase

- Command and Control (TA0037)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Out of Band Data technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Out of Band Data
- [ ] Check iOS devices for indicators of Out of Band Data
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Out of Band Data by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1644 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance

Users should be instructed to not grant applications unexpected or unnecessary permissions.

## Detection

### Detection of Out of Band Data

## Risk Assessment

| Finding                               | Severity | Impact              |
| ------------------------------------- | -------- | ------------------- |
| Out of Band Data technique applicable | Low      | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [MITRE ATT&CK Mobile - T1644](https://attack.mitre.org/techniques/T1644)
