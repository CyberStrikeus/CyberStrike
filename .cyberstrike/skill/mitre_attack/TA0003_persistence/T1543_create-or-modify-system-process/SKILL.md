---
name: "T1543_create-or-modify-system-process"
description: "Adversaries may create or modify system-level processes to repeatedly execute malicious payloads as part of persistence."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1543
  - persistence
  - privilege-escalation
  - windows
  - macos
  - linux
  - containers
technique_id: "T1543"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Windows
  - macOS
  - Linux
  - Containers
mitre_url: "https://attack.mitre.org/techniques/T1543"
tech_stack:
  - windows
  - macos
  - linux
  - containers
cwe_ids:
  - CWE-276
chains_with:
  - T1543.001
  - T1543.002
  - T1543.003
  - T1543.004
  - T1543.005
prerequisites:
  []
severity_boost:
  T1543.001: "Chain with T1543.001 for deeper attack path"
  T1543.002: "Chain with T1543.002 for deeper attack path"
  T1543.003: "Chain with T1543.003 for deeper attack path"
---

# T1543 Create or Modify System Process

## High-Level Description

Adversaries may create or modify system-level processes to repeatedly execute malicious payloads as part of persistence. When operating systems boot up, they can start processes that perform background system functions. On Windows and Linux, these system processes are referred to as services. On macOS, launchd processes known as Launch Daemon and Launch Agent are run to finish system initialization and load user specific parameters. 

Adversaries may install new services, daemons, or agents that can be configured to execute at startup or a repeatable interval in order to establish persistence. Similarly, adversaries may modify existing services, daemons, or agents to achieve the same effect. 

Services, daemons, or agents may be created with administrator privileges but executed under root/SYSTEM privileges. Adversaries may leverage this functionality to create or modify system processes in order to escalate privileges.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows, macOS, Linux, Containers

## What to Check

- [ ] Identify if Create or Modify System Process technique is applicable to target environment
- [ ] Check Windows systems for indicators of Create or Modify System Process
- [ ] Check macOS systems for indicators of Create or Modify System Process
- [ ] Check Linux systems for indicators of Create or Modify System Process
- [ ] Verify mitigations are bypassed or absent (9 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Create or Modify System Process by examining the target platforms (Windows, macOS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1543 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management
Limit privileges of user accounts and groups so that only authorized administrators can interact with system-level process changes and service configurations.

### M1040 Behavior Prevention on Endpoint
On Windows 10, enable Attack Surface Reduction (ASR) rules to prevent an application from writing a signed vulnerable driver to the system. On Windows 10 and 11, enable Microsoft Vulnerable Driver Blocklist to assist in hardening against third party-developed drivers.

### M1033 Limit Software Installation
Restrict software installation to trusted repositories only and be cautious of orphaned software packages.

### M1026 Privileged Account Management
Manage the creation, modification, use, and permissions associated to privileged accounts, including SYSTEM and root.

### M1028 Operating System Configuration
Ensure that Driver Signature Enforcement is enabled to restrict unsigned drivers from being installed.

### M1047 Audit
Use auditing tools capable of detecting privilege and service abuse opportunities on systems within an enterprise and correct them.

### M1054 Software Configuration
Where possible, consider enforcing the use of container services in rootless mode to limit the possibility of privilege escalation or malicious effects on the host running the container.

### M1022 Restrict File and Directory Permissions
Restrict read/write access to system-level process files to only select privileged users who have a legitimate need to manage system services.

### M1045 Code Signing
Enforce registration and execution of only legitimately signed service drivers where possible.


## Detection

### Detection of System Process Creation or Modification Across Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Create or Modify System Process technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [AppleDocs Launch Agent Daemons](https://developer.apple.com/library/content/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
- [TechNet Services](https://technet.microsoft.com/en-us/library/cc772408.aspx)
- [OSX Malware Detection](https://papers.put.as/papers/macosx/2016/RSA_OSX_Malware.pdf)
- [Atomic Red Team - T1543](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1543)
- [MITRE ATT&CK - T1543](https://attack.mitre.org/techniques/T1543)
