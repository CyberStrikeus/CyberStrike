---
name: "T1627.001_geofencing"
description: "Adversaries may use a device’s geographical location to limit certain malicious behaviors."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1627.001
  - defense-evasion
  - android
  - ios
  - sub-technique
technique_id: "T1627.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1627/001"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-693
chains_with:
  - T1627
prerequisites:
  - T1627
severity_boost:
  T1627: "Chain with T1627 for deeper attack path"
---

# T1627.001 Geofencing

> **Sub-technique of:** T1627

## High-Level Description

Adversaries may use a device’s geographical location to limit certain malicious behaviors. For example, malware operators may limit the distribution of a second stage payload to certain geographic regions.

Geofencing is accomplished by persuading the user to grant the application permission to access location services. The application can then collect, process, and exfiltrate the device’s location to perform location-based actions, such as ceasing malicious behavior or showing region-specific advertisements. 

One method to accomplish Geofencing on Android is to use the built-in Geofencing API to automatically trigger certain behaviors when the device enters or exits a specified radius around a geographical location. Similar to other Geofencing methods, this requires that the user has granted the `ACCESS_FINE_LOCATION` and `ACCESS_BACKGROUND_LOCATION` permissions. The latter is only required if the application targets Android 10 (API level 29) or higher. However, Android 11 introduced additional permission controls that may restrict background location collection based on user permission choices at runtime. These additional controls include "Allow only while using the app", which will effectively prohibit background location collection. 

Similarly, on iOS, developers can use built-in APIs to setup and execute geofencing. Depending on the use case, the app will either need to call `requestWhenInUseAuthorization()` or `requestAlwaysAuthorization()`, depending on when access to the location services is required. Similar to Android, users also have the option to limit when the application can access the device’s location, including one-time use and only when the application is running in the foreground. 

Geofencing can be used to prevent exposure of capabilities in environments that are not intended to be compromised or operated within. For example, location data could be used to limit malware spread and/or capabilities, which could also potentially evade application analysis environments (ex: malware analysis outside of the target geographic area). Other malicious usages could include showing language-specific input prompts and/or advertisements.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Geofencing technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Geofencing
- [ ] Check iOS devices for indicators of Geofencing
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Geofencing by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1627.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance
Users should be advised to be extra scrutinous of applications that request location, and to deny any permissions requests for applications they do not recognize.

### M1006 Use Recent OS Version
New OS releases frequently contain additional limitations or controls around device location access.


## Detection

### Detection of Geofencing


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Geofencing technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Lookout eSurv](https://blog.lookout.com/esurv-research)
- [MITRE ATT&CK Mobile - T1627.001](https://attack.mitre.org/techniques/T1627/001)
