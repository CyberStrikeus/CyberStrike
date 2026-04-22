---
name: "T1574.014_appdomainmanager"
description: "Adversaries may execute their own malicious payloads by hijacking how the .NET `AppDomainManager` loads assemblies."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1574.014
  - persistence
  - privilege-escalation
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1574.014"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1574/014"
tech_stack:
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1574
  - T1574.001
  - T1574.004
  - T1574.005
  - T1574.006
  - T1574.007
  - T1574.008
  - T1574.009
  - T1574.010
  - T1574.011
  - T1574.012
  - T1574.013
prerequisites:
  - T1574
severity_boost:
  T1574: "Chain with T1574 for deeper attack path"
  T1574.001: "Chain with T1574.001 for deeper attack path"
  T1574.004: "Chain with T1574.004 for deeper attack path"
---

# T1574.014 AppDomainManager

> **Sub-technique of:** T1574

## High-Level Description

Adversaries may execute their own malicious payloads by hijacking how the .NET `AppDomainManager` loads assemblies. The .NET framework uses the `AppDomainManager` class to create and manage one or more isolated runtime environments (called application domains) inside a process to host the execution of .NET applications. Assemblies (`.exe` or `.dll` binaries compiled to run as .NET code) may be loaded into an application domain as executable code. 

Known as "AppDomainManager injection," adversaries may execute arbitrary code by hijacking how .NET applications load assemblies. For example, malware may create a custom application domain inside a target process to load and execute an arbitrary assembly. Alternatively, configuration files (`.config`) or process environment variables that define .NET runtime settings may be tampered with to instruct otherwise benign .NET applications to load a malicious assembly (identified by name) into the target process.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)
- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if AppDomainManager technique is applicable to target environment
- [ ] Check Windows systems for indicators of AppDomainManager
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to AppDomainManager by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1574.014 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1022 Restrict File and Directory Permissions
Install .NET applications and related software in write-protected locations. Set directory access controls to prevent file writes to the search paths for .NET applications, both in the folders where applications are run from and the standard resources folders.


## Detection

### Detection Strategy for Hijack Execution Flow through the AppDomainManager on Windows.


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| AppDomainManager technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [PenTestLabs AppDomainManagerInject](https://pentestlaboratories.com/2020/05/26/appdomainmanager-injection-and-detection/)
- [Microsoft App Domains](https://learn.microsoft.com/dotnet/framework/app-domains/application-domains)
- [PwC Yellow Liderc](https://www.pwc.com/gx/en/issues/cybersecurity/cyber-threat-intelligence/yellow-liderc-ships-its-scripts-delivers-imaploader-malware.html)
- [Rapid7 AppDomain Manager Injection](https://www.rapid7.com/blog/post/2023/05/05/appdomain-manager-injection-new-techniques-for-red-teams/)
- [Atomic Red Team - T1574.014](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1574.014)
- [MITRE ATT&CK - T1574.014](https://attack.mitre.org/techniques/T1574/014)
