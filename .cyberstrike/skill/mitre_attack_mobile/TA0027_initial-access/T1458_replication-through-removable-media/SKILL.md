---
name: "T1458_replication-through-removable-media"
description: "Adversaries may move onto devices by exploiting or copying malware to devices connected via USB."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1458
  - initial-access
  - lateral-movement
  - android
  - ios
technique_id: "T1458"
tactic: "initial-access"
all_tactics:
  - initial-access
  - lateral-movement
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1458"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-20
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1458 Replication Through Removable Media

## High-Level Description

Adversaries may move onto devices by exploiting or copying malware to devices connected via USB. In the case of Lateral Movement, adversaries may utilize the physical connection of a device to a compromised or malicious charging station or PC to bypass application store requirements and install malicious applications directly. In the case of Initial Access, adversaries may attempt to exploit the device via the connection to gain access to data stored on the device. Examples of this include: 
 
* Exploiting insecure bootloaders in a Nexus 6 or 6P device over USB and gaining the ability to perform actions including intercepting phone calls, intercepting network traffic, and obtaining the device physical location. 
* Exploiting weakly-enforced security boundaries in Android devices such as the Google Pixel 2 over USB. 
* Products from Cellebrite and Grayshift purportedly that can exploit some iOS devices using physical access to the data port to unlock the passcode.

## Kill Chain Phase

- Initial Access (TA0027)
- Lateral Movement (TA0033)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Replication Through Removable Media technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Replication Through Removable Media
- [ ] Check iOS devices for indicators of Replication Through Removable Media
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Replication Through Removable Media by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1458 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1003 Lock Bootloader
Users should ensure bootloaders are locked to prevent arbitrary operating system code from being flashed onto the device.

### M1006 Use Recent OS Version
iOS 11.4.1 and higher introduce USB Restricted Mode, which disables data access through the device's charging port under certain conditions (making the port only usable for power), likely preventing this technique from working.

### M1011 User Guidance
Users should be advised not to use public charging stations or computers to charge their devices. Instead, users should be issued a charger acquired from a trustworthy source. Users should be advised not to click on device prompts to trust attached computers unless absolutely necessary.

### M1012 Enterprise Policy
Enterprise policies should prevent enabling USB debugging on Android devices unless specifically needed (e.g., if the device is used for application development).

### M1001 Security Updates
Security updates often contain patches for vulnerabilities.


## Detection

### Detection of Replication Through Removable Media


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Replication Through Removable Media technique applicable | High | Initial Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [Krebs-JuiceJacking](http://krebsonsecurity.com/2011/08/beware-of-juice-jacking/)
- [GoogleProjectZero-OATmeal](https://googleprojectzero.blogspot.com/2018/09/oatmeal-on-universal-cereal-bus.html)
- [Lau-Mactans](https://media.blackhat.com/us-13/US-13-Lau-Mactans-Injecting-Malware-into-iOS-Devices-via-Malicious-Chargers-WP.pdf)
- [Computerworld-iPhoneCracking](https://www.techcentral.ie/two-vendors-now-sell-iphone-cracking-technology-police-buying/)
- [IBM-NexusUSB](https://securityintelligence.com/android-vulnerabilities-attacking-nexus-6-and-6p-custom-boot-modes/)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/physical-threats/PHY-1.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/physical-threats/PHY-2.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/stack-threats/STA-6.html)
- [MITRE ATT&CK Mobile - T1458](https://attack.mitre.org/techniques/T1458)
