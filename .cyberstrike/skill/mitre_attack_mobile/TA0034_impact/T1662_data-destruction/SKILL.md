---
name: "T1662_data-destruction"
description: "Adversaries may destroy data and files on specific devices or in large numbers to interrupt availability to systems, services, and network resources."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1662
  - impact
  - android
technique_id: "T1662"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1662"
tech_stack:
  - android
cwe_ids:
  - CWE-400
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1662 Data Destruction

## High-Level Description

Adversaries may destroy data and files on specific devices or in large numbers to interrupt availability to systems, services, and network resources. Data destruction is likely to render stored data irrecoverable by forensic techniques through overwriting files or data on local and remote drives. 

To achieve data destruction, adversaries may use the `pm uninstall` command to uninstall packages or the `rm` command to remove specific files. For example, adversaries may first use `pm uninstall` to uninstall non-system apps, and then use `rm (-f) <file(s)>` to delete specific files, further hiding malicious activity.

## Kill Chain Phase

- Impact (TA0034)

**Platforms:** Android

## What to Check

- [ ] Identify if Data Destruction technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Data Destruction
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Data Destruction by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1662 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance
Users should be trained on what device administrator permission request prompts look like, and how to avoid granting permissions on phishing popups.


## Detection

### Detection of Data Destruction


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Data Destruction technique applicable | Low | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [rootnik_rooting_tool](https://unit42.paloaltonetworks.com/rootnik-android-trojan-abuses-commercial-rooting-tool-and-steals-private-information/)
- [abuse_native_linux_tools](https://www.trendmicro.com/en_za/research/22/i/how-malicious-actors-abuse-native-linux-tools-in-their-attacks.html)
- [MITRE ATT&CK Mobile - T1662](https://attack.mitre.org/techniques/T1662)
