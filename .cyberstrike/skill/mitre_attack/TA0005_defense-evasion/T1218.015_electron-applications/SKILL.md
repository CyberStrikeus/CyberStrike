---
name: "T1218.015_electron-applications"
description: "Adversaries may abuse components of the Electron framework to execute malicious code."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1218.015
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1218.015"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1218/015"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1218
  - T1218.001
  - T1218.002
  - T1218.003
  - T1218.004
  - T1218.005
  - T1218.007
  - T1218.008
  - T1218.009
  - T1218.010
  - T1218.011
  - T1218.012
  - T1218.013
  - T1218.014
prerequisites:
  - T1218
severity_boost:
  T1218: "Chain with T1218 for deeper attack path"
  T1218.001: "Chain with T1218.001 for deeper attack path"
  T1218.002: "Chain with T1218.002 for deeper attack path"
---

# T1218.015 Electron Applications

> **Sub-technique of:** T1218

## High-Level Description

Adversaries may abuse components of the Electron framework to execute malicious code. The Electron framework hosts many common applications such as Signal, Slack, and Microsoft Teams. Originally developed by GitHub, Electron is a cross-platform desktop application development framework that employs web technologies like JavaScript, HTML, and CSS. The Chromium engine is used to display web content and Node.js runs the backend code.

Due to the functional mechanics of Electron (such as allowing apps to run arbitrary commands), adversaries may also be able to perform malicious functions in the background potentially disguised as legitimate tools within the framework. For example, the abuse of `teams.exe` and `chrome.exe` may allow adversaries to execute malicious commands as child processes of the legitimate application (e.g., `chrome.exe --disable-gpu-sandbox --gpu-launcher="C:\Windows\system32\cmd.exe /c calc.exe`).

Adversaries may also execute malicious content by planting malicious JavaScript within Electron applications.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Electron Applications technique is applicable to target environment
- [ ] Check Linux systems for indicators of Electron Applications
- [ ] Check macOS systems for indicators of Electron Applications
- [ ] Check Windows systems for indicators of Electron Applications
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Electron Applications by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1218.015 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1050 Exploit Protection
Microsoft's Enhanced Mitigation Experience Toolkit (EMET) Attack Surface Reduction (ASR) feature can be used to block methods of using trusted binaries to bypass application control. 
Ensure that Electron is updated to the latest version and critical vulnerabilities (such as nodeIntegration bypasses) are patched and cannot be exploited.

### M1042 Disable or Remove Feature or Program
Remove or deny access to unnecessary and potentially vulnerable software and features to prevent abuse by adversaries. Many native binaries may not be necessary within a given environment: for example, consider disabling the Node.js integration in all renderers that display remote content to protect users by limiting adversaries’ power to plant malicious JavaScript within Electron applications.

### M1038 Execution Prevention
Where possible, enforce binary and application integrity with digital signature verification to prevent untrusted code from executing. For example, do not use `shell.openExternal` with untrusted content.

Where possible, set `nodeIntegration` to false, which disables access to the Node.js function. By disabling access to the Node.js function, this may limit the ability to execute malicious commands by injecting JavaScript code.

Do not disable `webSecurity`, which may allow for users of the application to invoke malicious content from online sources.


## Detection

### Detecting Electron Application Abuse for Proxy Execution


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Electron Applications technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Electron 3](https://www.kaspersky.com/blog/electron-framework-security-issues/49035/)
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- [Electron 6-8](https://medium.com/@MalFuzzer/one-electron-to-rule-them-all-dc2e9b263daf)
- [Electron 1](https://www.mend.io/blog/theres-a-new-stealer-variant-in-town-and-its-using-electron-to-stay-fully-undetected/)
- [Electron 2](https://www.first.org/resources/papers/conf2023/FIRSTCON23-TLP-CLEAR-Horejsi-Abusing-Electron-Based-Applications-in-Targeted-Attacks.pdf)
- [Atomic Red Team - T1218.015](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1218.015)
- [MITRE ATT&CK - T1218.015](https://attack.mitre.org/techniques/T1218/015)
