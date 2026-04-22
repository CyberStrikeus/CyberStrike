---
name: "T1616_call-control"
description: "Adversaries may make, forward, or block phone calls without user authorization."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1616
  - collection
  - impact
  - command-and-control
  - android
technique_id: "T1616"
tactic: "collection"
all_tactics:
  - collection
  - impact
  - command-and-control
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1616"
tech_stack:
  - android
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1616 Call Control

## High-Level Description

Adversaries may make, forward, or block phone calls without user authorization. This could be used for adversary goals such as audio surveillance, blocking or forwarding calls from the device owner, or C2 communication.

Several permissions may be used to programmatically control phone calls, including:

- `ANSWER_PHONE_CALLS` - Allows the application to answer incoming phone calls
- `CALL_PHONE` - Allows the application to initiate a phone call without going through the Dialer interface
- `PROCESS_OUTGOING_CALLS` - Allows the application to see the number being dialed during an outgoing call with the option to redirect the call to a different number or abort the call altogether
- `MANAGE_OWN_CALLS` - Allows a calling application which manages its own calls through the self-managed `ConnectionService` APIs
- `BIND_TELECOM_CONNECTION_SERVICE` - Required permission when using a `ConnectionService`
- `WRITE_CALL_LOG` - Allows an application to write to the device call log, potentially to hide malicious phone calls

When granted some of these permissions, an application can make a phone call without opening the dialer first. However, if an application desires to simply redirect the user to the dialer with a phone number filled in, it can launch an Intent using `Intent.ACTION_DIAL`, which requires no specific permissions. This then requires the user to explicitly initiate the call or use some form of Input Injection to programmatically initiate it.

## Kill Chain Phase

- Collection (TA0035)
- Impact (TA0034)
- Command and Control (TA0037)

**Platforms:** Android

## What to Check

- [ ] Identify if Call Control technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Call Control
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Call Control by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1616 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance

Users should be encouraged to be very careful with what applications they grant phone call-based permissions to. Further, users should not change their default call handler to applications they do not recognize.

## Detection

### Detection of Call Control

## Risk Assessment

| Finding                           | Severity | Impact     |
| --------------------------------- | -------- | ---------- |
| Call Control technique applicable | High     | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Android Permissions](https://developer.android.com/reference/android/Manifest.permission)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-41.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/cellular-threats/CEL-42.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/cellular-threats/CEL-36.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/cellular-threats/CEL-18.html)
- [MITRE ATT&CK Mobile - T1616](https://attack.mitre.org/techniques/T1616)
