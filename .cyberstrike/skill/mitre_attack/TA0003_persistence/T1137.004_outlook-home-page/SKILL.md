---
name: "T1137.004_outlook-home-page"
description: "Adversaries may abuse Microsoft Outlook's Home Page feature to obtain persistence on a compromised system."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1137.004
  - persistence
  - windows
  - office-suite
  - sub-technique
technique_id: "T1137.004"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Windows
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1137/004"
tech_stack:
  - windows
  - office
cwe_ids:
  - CWE-276
chains_with:
  - T1137
  - T1137.001
  - T1137.002
  - T1137.003
  - T1137.005
  - T1137.006
prerequisites:
  - T1137
severity_boost:
  T1137: "Chain with T1137 for deeper attack path"
  T1137.001: "Chain with T1137.001 for deeper attack path"
  T1137.002: "Chain with T1137.002 for deeper attack path"
---

# T1137.004 Outlook Home Page

> **Sub-technique of:** T1137

## High-Level Description

Adversaries may abuse Microsoft Outlook's Home Page feature to obtain persistence on a compromised system. Outlook Home Page is a legacy feature used to customize the presentation of Outlook folders. This feature allows for an internal or external URL to be loaded and presented whenever a folder is opened. A malicious HTML page can be crafted that will execute code when loaded by Outlook Home Page.

Once malicious home pages have been added to the user’s mailbox, they will be loaded when Outlook is started. Malicious Home Pages will execute when the right Outlook folder is loaded/reloaded.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Windows, Office Suite

## What to Check

- [ ] Identify if Outlook Home Page technique is applicable to target environment
- [ ] Check Windows systems for indicators of Outlook Home Page
- [ ] Check Office Suite systems for indicators of Outlook Home Page
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Install Outlook Home Page Persistence

This test simulates persistence being added to a host via the Outlook Home Page functionality. This causes Outlook to retrieve URL containing a malicious payload every time the targeted folder is viewed.

Triggering the payload requires manually opening Outlook and viewing the targetted folder (e.g. Inbox).

**Supported Platforms:** windows

```cmd
reg.exe add HKCU\Software\Microsoft\Office\#{outlook_version}\Outlook\WebView\#{outlook_folder} /v URL /t REG_SZ /d #{url} /f
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Outlook Home Page by examining the target platforms (Windows, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1137.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1051 Update Software
For the Outlook methods, blocking macros may be ineffective as the Visual Basic engine used for these features is separate from the macro scripting engine. Microsoft has released patches to try to address each issue. Ensure KB3191938 which blocks Outlook Visual Basic and displays a malicious code warning, KB4011091 which disables custom forms by default, and KB4011162 which removes the legacy Home Page feature, are applied to systems.

### M1040 Behavior Prevention on Endpoint
On Windows 10, enable Attack Surface Reduction (ASR) rules to prevent Office applications from creating child processes and from writing potentially malicious executable content to disk.


## Detection

### Detect Persistence via Outlook Home Page Exploitation


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Outlook Home Page technique applicable | Low | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Microsoft Detect Outlook Forms](https://docs.microsoft.com/en-us/office365/securitycompliance/detect-and-remediate-outlook-rules-forms-attack)
- [SensePost NotRuler](https://github.com/sensepost/notruler)
- [SensePost Outlook Home Page](https://sensepost.com/blog/2017/outlook-home-page-another-ruler-vector/)
- [Atomic Red Team - T1137.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1137.004)
- [MITRE ATT&CK - T1137.004](https://attack.mitre.org/techniques/T1137/004)
