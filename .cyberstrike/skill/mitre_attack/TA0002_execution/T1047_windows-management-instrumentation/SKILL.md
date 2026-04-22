---
name: "T1047_windows-management-instrumentation"
description: "Adversaries may abuse Windows Management Instrumentation (WMI) to execute malicious commands and payloads."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1047
  - execution
  - windows
technique_id: "T1047"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1047"
tech_stack:
  - windows
cwe_ids:
  - CWE-94
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1047 Windows Management Instrumentation

## High-Level Description

Adversaries may abuse Windows Management Instrumentation (WMI) to execute malicious commands and payloads. WMI is designed for programmers and is the infrastructure for management data and operations on Windows systems. WMI is an administration feature that provides a uniform environment to access Windows system components.

The WMI service enables both local and remote access, though the latter is facilitated by Remote Services such as Distributed Component Object Model and Windows Remote Management. Remote WMI over DCOM operates using port 135, whereas WMI over WinRM operates over port 5985 when using HTTP and 5986 for HTTPS.

An adversary can use WMI to interact with local and remote systems and use it as a means to execute various behaviors, such as gathering information for Discovery as well as Execution of commands and payloads. For example, `wmic.exe` can be abused by an adversary to delete shadow copies with the command `wmic.exe Shadowcopy Delete` (i.e., Inhibit System Recovery).

**Note:** `wmic.exe` is deprecated as of January of 2024, with the WMIC feature being “disabled by default” on Windows 11+. WMIC will be removed from subsequent Windows releases and replaced by PowerShell as the primary WMI interface. In addition to PowerShell and tools like `wbemtool.exe`, COM APIs can also be used to programmatically interact with WMI via C++, .NET, VBScript, etc.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Windows

## What to Check

- [ ] Identify if Windows Management Instrumentation technique is applicable to target environment
- [ ] Check Windows systems for indicators of Windows Management Instrumentation
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: WMI Reconnaissance Users

An adversary might use WMI to list all local User Accounts.
When the test completes , there should be local user accounts information displayed on the command line.

**Supported Platforms:** windows

```cmd
wmic useraccount get /ALL /format:csv
```

### Atomic Test 2: WMI Reconnaissance Processes

An adversary might use WMI to list Processes running on the compromised host.
When the test completes , there should be running processes listed on the command line.

**Supported Platforms:** windows

```cmd
wmic process get caption,executablepath,commandline /format:csv
```

### Atomic Test 3: WMI Reconnaissance Software

An adversary might use WMI to list installed Software hotfix and patches.
When the test completes, there should be a list of installed patches and when they were installed.

**Supported Platforms:** windows

```cmd
wmic qfe get description,installedOn /format:csv
```

### Atomic Test 4: WMI Reconnaissance List Remote Services

An adversary might use WMI to check if a certain Remote Service is running on a remote device.
When the test completes, a service information will be displayed on the screen if it exists.
A common feedback message is that "No instance(s) Available" if the service queried is not running.
A common error message is "Node - (provided IP or default) ERROR Description =The RPC server is unavailable"
if the provided remote host is unreachable

**Supported Platforms:** windows

```cmd
wmic /node:"#{node}" service where (caption like "%#{service_search_string}%")
```

### Atomic Test 5: WMI Execute Local Process

This test uses wmic.exe to execute a process on the local host.
When the test completes , a new process will be started locally .A notepad application will be started when input is left on default.

**Supported Platforms:** windows

```cmd
wmic process call create #{process_to_execute}
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Windows Management Instrumentation by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1047 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management

Prevent credential overlap across systems of administrator and privileged accounts.

### M1040 Behavior Prevention on Endpoint

On Windows 10, enable Attack Surface Reduction (ASR) rules to block processes created by WMI commands from running. Note: many legitimate tools and applications utilize WMI for command execution.

### M1018 User Account Management

By default, only administrators are allowed to connect remotely using WMI. Restrict other users who are allowed to connect, or disallow all users to connect remotely to WMI.

### M1038 Execution Prevention

Use application control configured to block execution of <code>wmic.exe</code> if it is not required for a given system or network to prevent potential misuse by adversaries. For example, in Windows 10 and Windows Server 2016 and above, Windows Defender Application Control (WDAC) policy rules may be applied to block the <code>wmic.exe</code> application and to prevent abuse.

## Detection

### Behavioral Detection Strategy for WMI Execution Abuse on Windows

## Risk Assessment

| Finding                                                 | Severity | Impact    |
| ------------------------------------------------------- | -------- | --------- |
| Windows Management Instrumentation technique applicable | Medium   | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [FireEye WMI 2015](https://www.fireeye.com/content/dam/fireeye-www/global/en/current-threats/pdfs/wp-windows-management-instrumentation.pdf)
- [Mandiant WMI](https://www.mandiant.com/resources/reports)
- [WMI 6](https://www.microsoft.com/en-us/security/blog/2022/06/13/the-many-lives-of-blackcat-ransomware/)
- [WMI 1-3](https://learn.microsoft.com/en-us/windows/win32/wmisdk/wmi-start-page?redirectedfrom=MSDN)
- [WMI 7,8](https://techcommunity.microsoft.com/t5/windows-it-pro-blog/wmi-command-line-wmic-utility-deprecation-next-steps/ba-p/4039242)
- [Atomic Red Team - T1047](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1047)
- [MITRE ATT&CK - T1047](https://attack.mitre.org/techniques/T1047)
