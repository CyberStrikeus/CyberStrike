---
name: "T1430_location-tracking"
description: "Adversaries may track a device’s physical location through use of standard operating system APIs via malicious or exploited applications on the compromised device."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1430
  - collection
  - discovery
  - android
  - ios
technique_id: "T1430"
tactic: "collection"
all_tactics:
  - collection
  - discovery
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1430"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with:
  - T1430.001
  - T1430.002
prerequisites: []
severity_boost:
  T1430.001: "Chain with T1430.001 for deeper attack path"
  T1430.002: "Chain with T1430.002 for deeper attack path"
---

# T1430 Location Tracking

## High-Level Description

Adversaries may track a device’s physical location through use of standard operating system APIs via malicious or exploited applications on the compromised device.

On Android, applications holding the `ACCESS_COAURSE_LOCATION` or `ACCESS_FINE_LOCATION` permissions provide access to the device’s physical location. On Android 10 and up, declaration of the `ACCESS_BACKGROUND_LOCATION` permission in an application’s manifest will allow applications to request location access even when the application is running in the background. Some adversaries have utilized integration of Baidu map services to retrieve geographical location once the location access permissions had been obtained.

On iOS, applications must include the `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`, and/or `NSLocationAlwaysUsageDescription` keys in their `Info.plist` file depending on the extent of requested access to location information. On iOS 8.0 and up, applications call `requestWhenInUseAuthorization()` to request access to location information when the application is in use or `requestAlwaysAuthorization()` to request access to location information regardless of whether the application is in use. With elevated privileges, an adversary may be able to access location data without explicit user consent with the `com.apple.locationd.preauthorized` entitlement key.

## Kill Chain Phase

- Collection (TA0035)
- Discovery (TA0032)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Location Tracking technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Location Tracking
- [ ] Check iOS devices for indicators of Location Tracking
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Location Tracking by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1430 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version

On Android 11 and up, users are not prompted with the option to select “Allow all the time” and must navigate to the settings page to manually select this option. On iOS 14 and up, users can select whether to provide Precise Location for each installed application.

### M1012 Enterprise Policy

If devices are enrolled using Apple User Enrollment or using a profile owner enrollment mode for Android, device controls prevent the enterprise from accessing the device’s physical location. This is typically used for a Bring Your Own Device (BYOD) deployment.

### M1011 User Guidance

Users should be wary of granting applications dangerous or privacy-intrusive permissions, such as access to location information. Users should also protect their account credentials and enable multi-factor authentication options when available.

### M1014 Interconnection Filtering

Filtering requests by checking request origin information may provide some defense against spurious operators.

## Detection

### Detection of Location Tracking

## Risk Assessment

| Finding                                | Severity | Impact     |
| -------------------------------------- | -------- | ---------- |
| Location Tracking technique applicable | High     | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Palo Alto HenBox](https://unit42.paloaltonetworks.com/unit42-henbox-chickens-come-home-roost/)
- [Android Request Location Permissions](https://developer.android.com/training/location/permissions)
- [Apple Requesting Authorization for Location Services](https://developer.apple.com/documentation/corelocation/requesting_authorization_for_location_services)
- [Google Project Zero Insomnia](https://googleprojectzero.blogspot.com/2019/08/implant-teardown.html)
- [PaloAlto-SpyDealer](https://researchcenter.paloaltonetworks.com/2017/07/unit42-spydealer-android-trojan-spying-40-apps/)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-24.html)
- [MITRE ATT&CK Mobile - T1430](https://attack.mitre.org/techniques/T1430)
