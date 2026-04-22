---
name: "T1137.003_outlook-forms"
description: "Adversaries may abuse Microsoft Outlook forms to obtain persistence on a compromised system."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1137.003
  - persistence
  - windows
  - office-suite
  - sub-technique
technique_id: "T1137.003"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Windows
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1137/003"
tech_stack:
  - windows
  - office
cwe_ids:
  - CWE-276
chains_with:
  - T1137
  - T1137.001
  - T1137.002
  - T1137.004
  - T1137.005
  - T1137.006
prerequisites:
  - T1137
severity_boost:
  T1137: "Chain with T1137 for deeper attack path"
  T1137.001: "Chain with T1137.001 for deeper attack path"
  T1137.002: "Chain with T1137.002 for deeper attack path"
---

# T1137.003 Outlook Forms

> **Sub-technique of:** T1137

## High-Level Description

Adversaries may abuse Microsoft Outlook forms to obtain persistence on a compromised system. Outlook forms are used as templates for presentation and functionality in Outlook messages. Custom Outlook forms can be created that will execute code when a specifically crafted email is sent by an adversary utilizing the same custom Outlook form.

Once malicious forms have been added to the user’s mailbox, they will be loaded when Outlook is started. Malicious forms will execute when an adversary sends a specifically crafted email to the user.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Windows, Office Suite

## What to Check

- [ ] Identify if Outlook Forms technique is applicable to target environment
- [ ] Check Windows systems for indicators of Outlook Forms
- [ ] Check Office Suite systems for indicators of Outlook Forms
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Outlook Forms by examining the target platforms (Windows, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1137.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1051 Update Software
For the Outlook methods, blocking macros may be ineffective as the Visual Basic engine used for these features is separate from the macro scripting engine. Microsoft has released patches to try to address each issue. Ensure KB3191938 which blocks Outlook Visual Basic and displays a malicious code warning, KB4011091 which disables custom forms by default, and KB4011162 which removes the legacy Home Page feature, are applied to systems.

### M1040 Behavior Prevention on Endpoint
On Windows 10, enable Attack Surface Reduction (ASR) rules to prevent Office applications from creating child processes and from writing potentially malicious executable content to disk.


## Detection

### Detect Persistence via Outlook Custom Forms Triggered by Malicious Email


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Outlook Forms technique applicable | Low | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Microsoft Detect Outlook Forms](https://docs.microsoft.com/en-us/office365/securitycompliance/detect-and-remediate-outlook-rules-forms-attack)
- [SensePost NotRuler](https://github.com/sensepost/notruler)
- [SensePost Outlook Forms](https://sensepost.com/blog/2017/outlook-forms-and-shells/)
- [Atomic Red Team - T1137.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1137.003)
- [MITRE ATT&CK - T1137.003](https://attack.mitre.org/techniques/T1137/003)
