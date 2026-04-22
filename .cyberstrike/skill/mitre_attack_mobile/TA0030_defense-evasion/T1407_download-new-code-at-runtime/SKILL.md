---
name: "T1407_download-new-code-at-runtime"
description: "Adversaries may download and execute dynamic code not included in the original application package after installation."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1407
  - defense-evasion
  - android
  - ios
technique_id: "T1407"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1407"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-693
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1407 Download New Code at Runtime

## High-Level Description

Adversaries may download and execute dynamic code not included in the original application package after installation. This technique is primarily used to evade static analysis checks and pre-publication scans in official app stores. In some cases, more advanced dynamic or behavioral analysis techniques could detect this behavior. However, in conjunction with Execution Guardrails techniques, detecting malicious code downloaded after installation could be difficult.

On Android, dynamic code could include native code, Dalvik code, or JavaScript code that utilizes Android WebView’s `JavascriptInterface` capability. 

On iOS, dynamic code could be downloaded and executed through 3rd party libraries such as JSPatch.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Download New Code at Runtime technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Download New Code at Runtime
- [ ] Check iOS devices for indicators of Download New Code at Runtime
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Download New Code at Runtime by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1407 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version
Applications that target Android API level 29 or higher cannot execute native code stored in the application's internal data storage directory, limiting the ability of applications to download and execute native code at runtime.


## Detection

### Detection of Download New Code at Runtime


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Download New Code at Runtime technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [FireEye-JSPatch](https://www.fireeye.com/blog/threat-research/2016/01/hot_or_not_the_bene.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-20.html)
- [MITRE ATT&CK Mobile - T1407](https://attack.mitre.org/techniques/T1407)
