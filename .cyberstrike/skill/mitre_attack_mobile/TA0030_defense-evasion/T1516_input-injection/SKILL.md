---
name: "T1516_input-injection"
description: "A malicious application can inject input to the user interface to mimic user interaction through the abuse of Android's accessibility APIs."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1516
  - defense-evasion
  - impact
  - android
technique_id: "T1516"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - impact
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1516"
tech_stack:
  - android
cwe_ids:
  - CWE-693
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1516 Input Injection

## High-Level Description

A malicious application can inject input to the user interface to mimic user interaction through the abuse of Android's accessibility APIs.

Input Injection can be achieved using any of the following methods:

* Mimicking user clicks on the screen, for example to steal money from a user's PayPal account.
* Injecting global actions, such as `GLOBAL_ACTION_BACK` (programatically mimicking a physical back button press), to trigger actions on behalf of the user.
* Inserting input into text fields on behalf of the user. This method is used legitimately to auto-fill text fields by applications such as password managers.

## Kill Chain Phase

- Defense Evasion (TA0030)
- Impact (TA0034)

**Platforms:** Android

## What to Check

- [ ] Identify if Input Injection technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Input Injection
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Input Injection by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1516 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance
Users should be warned against granting access to accessibility features, and to carefully scrutinize applications that request this dangerous permission.

### M1012 Enterprise Policy
An EMM/MDM can use the Android `DevicePolicyManager.setPermittedAccessibilityServices` method to set an explicit list of applications that are allowed to use Android's accessibility features.


## Detection

### Detection of Input Injection


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Input Injection technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [bitwarden autofill logins](https://help.bitwarden.com/article/auto-fill-android/)
- [android-trojan-steals-paypal-2fa](https://www.welivesecurity.com/2018/12/11/android-trojan-steals-money-paypal-accounts-2fa/)
- [Talos Gustuff Apr 2019](https://blog.talosintelligence.com/2019/04/gustuff-targets-australia.html)
- [MITRE ATT&CK Mobile - T1516](https://attack.mitre.org/techniques/T1516)
