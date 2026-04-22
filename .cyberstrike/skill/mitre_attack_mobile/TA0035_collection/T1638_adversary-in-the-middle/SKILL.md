---
name: "T1638_adversary-in-the-middle"
description: "Adversaries may attempt to position themselves between two or more networked devices to support follow-on behaviors such as Transmitted Data Manipulation or Endpoint Denial of Service."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1638
  - collection
  - android
  - ios
technique_id: "T1638"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1638"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1638 Adversary-in-the-Middle

## High-Level Description

Adversaries may attempt to position themselves between two or more networked devices to support follow-on behaviors such as Transmitted Data Manipulation or Endpoint Denial of Service. 

 

Adversary-in-the-Middle can be achieved through several mechanisms. For example, a malicious application may register itself as a VPN client, effectively redirecting device traffic to adversary-owned resources. Registering as a VPN client requires user consent on both Android and iOS; additionally, a special entitlement granted by Apple is needed for iOS devices. Alternatively, a malicious application with escalation privileges may utilize those privileges to gain access to network traffic. 


 Specific to Android devices, adversary-in-the-disk is a type of AiTM attack where adversaries monitor and manipulate data that is exchanged between applications and external storage. To accomplish this, a malicious application firsts requests for access to multimedia files on the device (`READ_EXTERNAL STORAGE` and `WRITE_EXTERNAL_STORAGE`), then the application reads data on the device and/or writes malware to the device. Though the request for access is common, when used maliciously, adversaries may access files and other sensitive data due to abusing the permission. Multiple applications were shown to be vulnerable against this attack; however, scrutiny of permissions and input validations may mitigate this attack. 

Outside of a mobile device, adversaries may be able to capture traffic by employing a rogue base station or Wi-Fi access point. These devices will allow adversaries to capture network traffic after it has left the device, while it is flowing to its destination. On a local network, enterprise techniques could be used, such as ARP Cache Poisoning or DHCP Spoofing. 

 

If applications properly encrypt their network traffic, sensitive data may not be accessible to adversaries, depending on the point of capture. For example, properly implementing Apple’s Application Transport Security (ATS) and Android’s Network Security Configuration (NSC) may prevent sensitive data leaks.

## Kill Chain Phase

- Collection (TA0035)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Adversary-in-the-Middle technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Adversary-in-the-Middle
- [ ] Check iOS devices for indicators of Adversary-in-the-Middle
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Adversary-in-the-Middle by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1638 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1009 Encrypt Network Traffic
Applications that properly encrypt network traffic may evade some forms of AiTM behavior.

### M1006 Use Recent OS Version
Recent OS versions have made it more difficult for applications to register as VPN providers.


## Detection

### Detection of Adversary-in-the-Middle


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Adversary-in-the-Middle technique applicable | High | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [mitd_checkpoint](https://blog.checkpoint.com/security/man-in-the-disk-a-new-attack-surface-for-android-apps/)
- [mitd_kaspersky](https://usa.kaspersky.com/blog/man-in-the-disk/16089/)
- [NSC_Android](https://www.nowsecure.com/blog/2018/08/15/a-security-analysts-guide-to-network-security-configuration-in-android-p/)
- [mitd_checkpoint_research](https://research.checkpoint.com/androids-man-in-the-disk/)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/cellular-threats/CEL-3.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-0.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-1.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-8.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/ecosystem-threats/ECO-12.html)
- [MITRE ATT&CK Mobile - T1638](https://attack.mitre.org/techniques/T1638)
