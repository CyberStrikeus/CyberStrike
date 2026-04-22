---
name: "T1577_compromise-application-executable"
description: "Adversaries may modify applications installed on a device to establish persistent access to a victim."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1577
  - persistence
  - android
technique_id: "T1577"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1577"
tech_stack:
  - android
cwe_ids:
  - CWE-276
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1577 Compromise Application Executable

## High-Level Description

Adversaries may modify applications installed on a device to establish persistent access to a victim. These malicious modifications can be used to make legitimate applications carry out adversary tasks when these applications are in use.

There are multiple ways an adversary can inject malicious code into applications. One method is by taking advantages of device vulnerabilities, the most well-known being Janus, an Android vulnerability that allows adversaries to add extra bytes to APK (application) and DEX (executable) files without affecting the file's signature. By being able to add arbitrary bytes to valid applications, attackers can seamlessly inject code into genuine executables without the user's knowledge.

Adversaries may also rebuild applications to include malicious modifications. This can be achieved by decompiling the genuine application, merging it with the malicious code, and recompiling it.

Adversaries may also take action to conceal modifications to application executables and bypass user consent. These actions include altering modifications to appear as an update or exploiting vulnerabilities that allow activities of the malicious application to run inside a system application.

## Kill Chain Phase

- Persistence (TA0028)

**Platforms:** Android

## What to Check

- [ ] Identify if Compromise Application Executable technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Compromise Application Executable
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Compromise Application Executable by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1577 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1001 Security Updates
Security updates frequently contain patches to vulnerabilities.

### M1006 Use Recent OS Version
Many vulnerabilities related to injecting code into existing applications have been patched in previous Android releases.


## Detection

### Detection of Compromise Application Executable


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Compromise Application Executable technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Guardsquare Janus](https://www.guardsquare.com/en/blog/new-android-vulnerability-allows-attackers-modify-apps-without-affecting-their-signatures)
- [CheckPoint Agent Smith](https://research.checkpoint.com/2019/agent-smith-a-new-species-of-mobile-malware/)
- [MITRE ATT&CK Mobile - T1577](https://attack.mitre.org/techniques/T1577)
