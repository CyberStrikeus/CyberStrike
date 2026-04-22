---
name: "T1574_hijack-execution-flow"
description: "Adversaries may execute their own malicious payloads by hijacking the way operating systems run programs."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1574
  - persistence
  - privilege-escalation
  - defense-evasion
  - linux
  - macos
  - windows
technique_id: "T1574"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1574"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-276
chains_with:
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
  - T1574.014
prerequisites: []
severity_boost:
  T1574.001: "Chain with T1574.001 for deeper attack path"
  T1574.004: "Chain with T1574.004 for deeper attack path"
  T1574.005: "Chain with T1574.005 for deeper attack path"
---

# T1574 Hijack Execution Flow

## High-Level Description

Adversaries may execute their own malicious payloads by hijacking the way operating systems run programs. Hijacking execution flow can be for the purposes of persistence, since this hijacked execution may reoccur over time. Adversaries may also use these mechanisms to elevate privileges or evade defenses, such as application control or other restrictions on execution.

There are many ways an adversary may hijack the flow of execution, including by manipulating how the operating system locates programs to be executed. How the operating system locates libraries to be used by a program can also be intercepted. Locations where the operating system looks for programs/resources, such as file directories and in the case of Windows the Registry, could also be poisoned to include malicious payloads.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)
- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Hijack Execution Flow technique is applicable to target environment
- [ ] Check Linux systems for indicators of Hijack Execution Flow
- [ ] Check macOS systems for indicators of Hijack Execution Flow
- [ ] Check Windows systems for indicators of Hijack Execution Flow
- [ ] Verify mitigations are bypassed or absent (10 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Hijack Execution Flow by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1574 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1052 User Account Control

Turn off UAC's privilege elevation for standard users <code>[HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System]</code> to automatically deny elevation requests, add: <code>"ConsentPromptBehaviorUser"=dword:00000000</code>. Consider enabling installer detection for all users by adding: <code>"EnableInstallerDetection"=dword:00000001</code>. This will prompt for a password for installation and also log the attempt. To disable installer detection, instead add: <code>"EnableInstallerDetection"=dword:00000000</code>. This may prevent potential elevation of privileges through exploitation during the process of UAC detecting the installer, but will allow the installation process to continue without being logged.

### M1040 Behavior Prevention on Endpoint

Some endpoint security solutions can be configured to block some types of behaviors related to process injection/memory tampering based on common sequences of indicators (ex: execution of specific API functions).

### M1044 Restrict Library Loading

Disallow loading of remote DLLs. This is included by default in Windows Server 2012+ and is available by patch for XP+ and Server 2003+.

Enable Safe DLL Search Mode to force search for system DLLs in directories with greater restrictions (e.g. <code>%SYSTEMROOT%</code>)to be used before local directory DLLs (e.g. a user's home directory)

The Safe DLL Search Mode can be enabled via Group Policy at Computer Configuration > [Policies] > Administrative Templates > MSS (Legacy): MSS: (SafeDllSearchMode) Enable Safe DLL search mode. The associated Windows Registry key for this is located at <code>HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\SafeDLLSearchMode</code>

### M1047 Audit

Use auditing tools capable of detecting hijacking opportunities on systems within an enterprise and correct them. Toolkits like the PowerSploit framework contain PowerUp modules that can be used to explore systems for hijacking weaknesses.

Use the program sxstrace.exe that is included with Windows along with manual inspection to check manifest files for side-loading vulnerabilities in software.

Find and eliminate path interception weaknesses in program configuration files, scripts, the PATH environment variable, services, and in shortcuts by surrounding PATH variables with quotation marks when functions allow for them. Be aware of the search order Windows uses for executing or loading binaries and use fully qualified paths wherever appropriate.

Clean up old Windows Registry keys when software is uninstalled to avoid keys with no associated legitimate binaries. Periodically search for and correct or report path interception weaknesses on systems that may have been introduced using custom or available tools that report software using insecure path configurations.

### M1013 Application Developer Guidance

When possible, include hash values in manifest files to help prevent side-loading of malicious libraries.

### M1018 User Account Management

Limit privileges of user accounts and groups so that only authorized administrators can interact with service changes and service binary target path locations. Deny execution from user directories such as file download directories and temp directories where able.

Ensure that proper permissions and directory access control are set to deny users the ability to write files to the top-level directory <code>C:</code> and system directories, such as <code>C:\Windows\</code>, to reduce places where malicious files could be placed for execution.

### M1051 Update Software

Update software regularly to include patches that fix DLL side-loading vulnerabilities.

### M1038 Execution Prevention

Adversaries may use new payloads to execute this technique. Identify and block potentially malicious software executed through hijacking by using application control solutions also capable of blocking libraries loaded by legitimate software.

### M1022 Restrict File and Directory Permissions

Install software in write-protected locations. Set directory access controls to prevent file writes to the search paths for applications, both in the folders where applications are run from and the standard library folders.

### M1024 Restrict Registry Permissions

Ensure proper permissions are set for Registry hives to prevent users from modifying keys for system components that may lead to privilege escalation.

## Detection

### Detection Strategy for Hijack Execution Flow across OS platforms.

## Risk Assessment

| Finding                                    | Severity | Impact      |
| ------------------------------------------ | -------- | ----------- |
| Hijack Execution Flow technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Autoruns for Windows](https://docs.microsoft.com/en-us/sysinternals/downloads/autoruns)
- [Atomic Red Team - T1574](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1574)
- [MITRE ATT&CK - T1574](https://attack.mitre.org/techniques/T1574)
