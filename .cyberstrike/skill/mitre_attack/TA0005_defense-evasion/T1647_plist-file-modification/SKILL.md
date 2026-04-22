---
name: "T1647_plist-file-modification"
description: "Adversaries may modify property list files (plist files) to enable other malicious activity, while also potentially evading and bypassing system defenses."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1647
  - defense-evasion
  - macos
technique_id: "T1647"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1647"
tech_stack:
  - macos
cwe_ids:
  - CWE-693
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1647 Plist File Modification

## High-Level Description

Adversaries may modify property list files (plist files) to enable other malicious activity, while also potentially evading and bypassing system defenses. macOS applications use plist files, such as the <code>info.plist</code> file, to store properties and configuration settings that inform the operating system how to handle the application at runtime. Plist files are structured metadata in key-value pairs formatted in XML based on Apple's Core Foundation DTD. Plist files can be saved in text or binary format. 

Adversaries can modify key-value pairs in plist files to influence system behaviors, such as hiding the execution of an application (i.e. Hidden Window) or running additional commands for persistence (ex: Launch Agent/Launch Daemon or Re-opened Applications).

For example, adversaries can add a malicious application path to the `~/Library/Preferences/com.apple.dock.plist` file, which controls apps that appear in the Dock. Adversaries can also modify the <code>LSUIElement</code> key in an application’s <code>info.plist</code> file to run the app in the background. Adversaries can also insert key-value pairs to insert environment variables, such as <code>LSEnvironment</code>, to enable persistence via Dynamic Linker Hijacking.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** macOS

## What to Check

- [ ] Identify if Plist File Modification technique is applicable to target environment
- [ ] Check macOS systems for indicators of Plist File Modification
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Plist Modification

Modify MacOS plist file in one of two directories

**Supported Platforms:** macos


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Plist File Modification by examining the target platforms (macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1647 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1013 Application Developer Guidance
Ensure applications are using Apple's developer guidance which enables hardened runtime.


## Detection

### Detection Strategy for Plist File Modification (T1647)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Plist File Modification technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [eset_osx_flashback](https://www.welivesecurity.com/wp-content/uploads/200x/white-papers/osx_flashback.pdf)
- [fileinfo plist file description](https://fileinfo.com/extension/plist)
- [wardle chp2 persistence](https://taomm.org/PDFs/vol1/CH%200x02%20Persistence.pdf)
- [Atomic Red Team - T1647](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1647)
- [MITRE ATT&CK - T1647](https://attack.mitre.org/techniques/T1647)
