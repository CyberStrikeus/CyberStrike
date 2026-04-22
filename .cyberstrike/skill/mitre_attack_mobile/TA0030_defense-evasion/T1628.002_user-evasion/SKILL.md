---
name: "T1628.002_user-evasion"
description: "Adversaries may attempt to avoid detection by hiding malicious behavior from the user."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1628.002
  - defense-evasion
  - android
  - sub-technique
technique_id: "T1628.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1628/002"
tech_stack:
  - android
cwe_ids:
  - CWE-693
chains_with:
  - T1628
  - T1628.001
  - T1628.003
prerequisites:
  - T1628
severity_boost:
  T1628: "Chain with T1628 for deeper attack path"
  T1628.001: "Chain with T1628.001 for deeper attack path"
  T1628.003: "Chain with T1628.003 for deeper attack path"
---

# T1628.002 User Evasion

> **Sub-technique of:** T1628

## High-Level Description

Adversaries may attempt to avoid detection by hiding malicious behavior from the user. By doing this, an adversary’s modifications would most likely remain installed on the device for longer, allowing the adversary to continue to operate on that device.

While there are many ways this can be accomplished, one method is by using the device’s sensors. By utilizing the various motion sensors on a device, such as accelerometer or gyroscope, an application could detect that the device is being interacted with. That way, the application could continue to run while the device is not in use but cease operating while the user is using the device, hiding anything that would indicate malicious activity was ongoing. Accessing the sensors in this way does not require any permissions from the user, so it would be completely transparent.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android

## What to Check

- [ ] Identify if User Evasion technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of User Evasion
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to User Evasion by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1628.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1010 Deploy Compromised Device Detection Method

Mobile security products that are part of the Samsung Knox for Mobile Threat Defense program could examine running applications while the device is idle, potentially detecting malicious applications that are running primarily when the device is not being used.

## Detection

### Detection of User Evasion

## Risk Assessment

| Finding                           | Severity | Impact          |
| --------------------------------- | -------- | --------------- |
| User Evasion technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [MITRE ATT&CK Mobile - T1628.002](https://attack.mitre.org/techniques/T1628/002)
