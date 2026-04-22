---
name: "T1218.013_mavinject"
description: "Adversaries may abuse mavinject.exe to proxy execution of malicious code."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1218.013
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1218.013"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1218/013"
tech_stack:
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
  - T1218.014
  - T1218.015
prerequisites:
  - T1218
severity_boost:
  T1218: "Chain with T1218 for deeper attack path"
  T1218.001: "Chain with T1218.001 for deeper attack path"
  T1218.002: "Chain with T1218.002 for deeper attack path"
---

# T1218.013 Mavinject

> **Sub-technique of:** T1218

## High-Level Description

Adversaries may abuse mavinject.exe to proxy execution of malicious code. Mavinject.exe is the Microsoft Application Virtualization Injector, a Windows utility that can inject code into external processes as part of Microsoft Application Virtualization (App-V).

Adversaries may abuse mavinject.exe to inject malicious DLLs into running processes (i.e. Dynamic-link Library Injection), allowing for arbitrary code execution (ex. <code>C:\Windows\system32\mavinject.exe PID /INJECTRUNNING PATH_DLL</code>). Since mavinject.exe may be digitally signed by Microsoft, proxying execution via this method may evade detection by security products because the execution is masked under a legitimate process.

In addition to Dynamic-link Library Injection, Mavinject.exe can also be abused to perform import descriptor injection via its <code>/HMODULE</code> command-line parameter (ex. <code>mavinject.exe PID /HMODULE=BASE_ADDRESS PATH_DLL ORDINAL_NUMBER</code>). This command would inject an import table entry consisting of the specified DLL into the module at the given base address.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Mavinject technique is applicable to target environment
- [ ] Check Windows systems for indicators of Mavinject
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Mavinject by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1218.013 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

Consider removing mavinject.exe if Microsoft App-V is not used within a given environment.

### M1038 Execution Prevention

Use application control configured to block execution of mavinject.exe if it is not required for a given system or network to prevent potential misuse by adversaries.

## Detection

### Detecting Code Injection via mavinject.exe (App-V Injector)

## Risk Assessment

| Finding                        | Severity | Impact          |
| ------------------------------ | -------- | --------------- |
| Mavinject technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [ATT Lazarus TTP Evolution](https://cybersecurity.att.com/blogs/labs-research/lazarus-campaign-ttps-and-evolution)
- [LOLBAS Mavinject](https://lolbas-project.github.io/lolbas/Binaries/Mavinject/)
- [Mavinject Functionality Deconstructed](https://posts.specterops.io/mavinject-exe-functionality-deconstructed-c29ab2cf5c0e)
- [Reaqta Mavinject](https://reaqta.com/2017/12/mavinject-microsoft-injector/)
- [Atomic Red Team - T1218.013](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1218.013)
- [MITRE ATT&CK - T1218.013](https://attack.mitre.org/techniques/T1218/013)
