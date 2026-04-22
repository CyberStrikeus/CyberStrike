---
name: "T1660_phishing"
description: "Adversaries may send malicious content to users in order to gain access to their mobile devices."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1660
  - initial-access
  - android
  - ios
technique_id: "T1660"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1660"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-20
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1660 Phishing

## High-Level Description

Adversaries may send malicious content to users in order to gain access to their mobile devices. All forms of phishing are electronically delivered social engineering. Adversaries can conduct both non-targeted phishing, such as in mass malware spam campaigns, as well as more targeted phishing tailored for a specific individual, company, or industry, known as “spearphishing.” Phishing often involves social engineering techniques, such as posing as a trusted source, as well as evasion techniques, such as removing or manipulating emails or metadata/headers from compromised accounts being abused to send messages.

Mobile phishing may take various forms. For example, adversaries may send emails containing malicious attachments or links, typically to deliver and then execute malicious code on victim devices. Phishing may also be conducted via third-party services, like social media platforms. Adversaries may also impersonate executives of organizations to persuade victims into performing some action on their behalf. For example, adversaries will often use social engineering techniques in text messages to trick the victims into acting quickly, which leads to adversaries obtaining credentials and other information.

Mobile devices are a particularly attractive target for adversaries executing phishing campaigns. Due to their smaller form factor than traditional desktop endpoints, users may not be able to notice minor differences between genuine and phishing websites. Further, mobile devices have additional sensors and radios that allow adversaries to execute phishing attempts over several different vectors, such as:

- SMS messages: Adversaries may send SMS messages (known as “smishing”) from compromised devices to potential targets to convince the target to, for example, install malware, navigate to a specific website, or enable certain insecure configurations on their device.
- Quick Response (QR) Codes: Adversaries may use QR codes (known as “quishing”) to redirect users to a phishing website. For example, an adversary could replace a legitimate public QR Code with one that leads to a different destination, such as a phishing website. A malicious QR code could also be delivered via other means, such as SMS or email. In the latter case, an adversary could utilize a malicious QR code in an email to pivot from the user’s desktop computer to their mobile device.
- Phone Calls: Adversaries may call victims (known as “vishing”) to persuade them to perform an action, such as providing login credentials or navigating to a malicious website. This could also be used as a technique to perform the initial access on a mobile device, but then pivot to a computer/other network by having the victim perform an action on a desktop computer.

## Kill Chain Phase

- Initial Access (TA0027)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Phishing technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Phishing
- [ ] Check iOS devices for indicators of Phishing
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Phishing by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1660 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance

Users can be trained to identify social engineering techniques and phishing emails.

### M1058 Antivirus/Antimalware

Some mobile security products offer a loopback VPN used for inspecting traffic. This could proactively block traffic to websites that are known for phishing or appear to be conducting a phishing attack.

## Detection

### Detection of Phishing

## Risk Assessment

| Finding                       | Severity | Impact         |
| ----------------------------- | -------- | -------------- |
| Phishing technique applicable | High     | Initial Access |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/authentication-threats/AUT-9.html)
- [MITRE ATT&CK Mobile - T1660](https://attack.mitre.org/techniques/T1660)
