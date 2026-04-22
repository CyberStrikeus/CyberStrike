---
name: "T1421_system-network-connections-discovery"
description: "Adversaries may attempt to get a listing of network connections to or from the compromised device they are currently accessing or from remote systems by querying for information over the network."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1421
  - discovery
  - android
technique_id: "T1421"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1421"
tech_stack:
  - android
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1421 System Network Connections Discovery

## High-Level Description

Adversaries may attempt to get a listing of network connections to or from the compromised device they are currently accessing or from remote systems by querying for information over the network. 

 

This is typically accomplished by utilizing device APIs to collect information about nearby networks, such as Wi-Fi, Bluetooth, and cellular tower connections. On Android, this can be done by querying the respective APIs: 

 

* `WifiInfo` for information about the current Wi-Fi connection, as well as nearby Wi-Fi networks. Querying the `WiFiInfo` API requires the application to hold the `ACCESS_FINE_LOCATION` permission. 

* `BluetoothAdapter` for information about Bluetooth devices, which also requires the application to hold several permissions granted by the user at runtime. 

* For Android versions prior to Q, applications can use the `TelephonyManager.getNeighboringCellInfo()` method. For Q and later, applications can use the `TelephonyManager.getAllCellInfo()` method. Both methods require the application hold the `ACCESS_FINE_LOCATION` permission.

## Kill Chain Phase

- Discovery (TA0032)

**Platforms:** Android

## What to Check

- [ ] Identify if System Network Connections Discovery technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of System Network Connections Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to System Network Connections Discovery by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1421 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of System Network Connections Discovery


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| System Network Connections Discovery technique applicable | Medium | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [MITRE ATT&CK Mobile - T1421](https://attack.mitre.org/techniques/T1421)
