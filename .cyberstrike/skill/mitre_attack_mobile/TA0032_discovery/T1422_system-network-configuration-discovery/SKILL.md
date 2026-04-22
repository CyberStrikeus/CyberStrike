---
name: "T1422_system-network-configuration-discovery"
description: "Adversaries may look for details about the network configuration and settings, such as IP and/or MAC addresses, of devices they access or through information discovery of remote systems."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1422
  - discovery
  - android
  - ios
technique_id: "T1422"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1422"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with:
  - T1422.001
  - T1422.002
prerequisites: []
severity_boost:
  T1422.001: "Chain with T1422.001 for deeper attack path"
  T1422.002: "Chain with T1422.002 for deeper attack path"
---

# T1422 System Network Configuration Discovery

## High-Level Description

Adversaries may look for details about the network configuration and settings, such as IP and/or MAC addresses, of devices they access or through information discovery of remote systems.

Adversaries may use the information from System Network Configuration Discovery during automated discovery to shape follow-on behaviors, including determining certain access within the target network and what actions to do next.

On Android, details of onboard network interfaces are accessible to apps through the `java.net.NetworkInterface` class. Previously, the Android `TelephonyManager` class could be used to gather telephony-related device identifiers, information such as the IMSI, IMEI, and phone number. However, starting with Android 10, only preloaded, carrier, the default SMS, or device and profile owner applications can access the telephony-related device identifiers.

On iOS, gathering network configuration information is not possible without root access.

Adversaries may use the information from System Network Configuration Discovery during automated discovery to shape follow-on behaviors, including determining certain access within the target network and what actions to do next.

## Kill Chain Phase

- Discovery (TA0032)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if System Network Configuration Discovery technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of System Network Configuration Discovery
- [ ] Check iOS devices for indicators of System Network Configuration Discovery
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to System Network Configuration Discovery by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1422 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version

Android 10 introduced changes that prevent normal applications from accessing sensitive device identifiers.

## Detection

### Detection of System Network Configuration Discovery

## Risk Assessment

| Finding                                                     | Severity | Impact    |
| ----------------------------------------------------------- | -------- | --------- |
| System Network Configuration Discovery technique applicable | Medium   | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [NetworkInterface](https://developer.android.com/reference/java/net/NetworkInterface.html)
- [TelephonyManager](https://developer.android.com/reference/android/telephony/TelephonyManager.html)
- [MITRE ATT&CK Mobile - T1422](https://attack.mitre.org/techniques/T1422)
