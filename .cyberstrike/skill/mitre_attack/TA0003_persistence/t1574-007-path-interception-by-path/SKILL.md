---
name: "T1574.007_path-interception-by-path-environment-variable"
description: "Adversaries may execute their own malicious payloads by hijacking environment variables used to load libraries."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1574.007
  - persistence
  - privilege-escalation
  - defense-evasion
  - windows
  - macos
  - linux
  - sub-technique
technique_id: "T1574.007"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
  - defense-evasion
platforms:
  - Windows
  - macOS
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1574/007"
tech_stack:
  - windows
  - macos
  - linux
cwe_ids:
  - CWE-276
chains_with:
  - T1574
  - T1574.001
  - T1574.004
  - T1574.005
  - T1574.006
  - T1574.008
  - T1574.009
  - T1574.010
  - T1574.011
  - T1574.012
  - T1574.013
  - T1574.014
prerequisites:
  - T1574
severity_boost:
  T1574: "Chain with T1574 for deeper attack path"
  T1574.001: "Chain with T1574.001 for deeper attack path"
  T1574.004: "Chain with T1574.004 for deeper attack path"
---

# T1574.007 Path Interception by PATH Environment Variable

> **Sub-technique of:** T1574

## High-Level Description

Adversaries may execute their own malicious payloads by hijacking environment variables used to load libraries. The PATH environment variable contains a list of directories (User and System) that the OS searches sequentially through in search of the binary that was called from a script or the command line.

Adversaries can place a malicious program in an earlier entry in the list of directories stored in the PATH environment variable, resulting in the operating system executing the malicious binary rather than the legitimate binary when it searches sequentially through that PATH listing.

For example, on Windows if an adversary places a malicious program named "net.exe" in `C:\example path`, which by default precedes `C:\Windows\system32\net.exe` in the PATH environment variable, when "net" is executed from the command-line the `C:\example path` will be called instead of the system's legitimate executable at `C:\Windows\system32\net.exe`. Some methods of executing a program rely on the PATH environment variable to determine the locations that are searched when the path for the program is not given, such as executing programs from a Command and Scripting Interpreter.

Adversaries may also directly modify the $PATH variable specifying the directories to be searched. An adversary can modify the `$PATH`variable to point to a directory they have write access. When a program using the $PATH variable is called, the OS searches the specified directory and executes the malicious binary. On macOS, this can also be performed through modifying the $HOME variable. These variables can be modified using the command-line, launchctl, Unix Shell Configuration Modification, or modifying the`/etc/paths.d` folder contents.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)
- Defense Evasion (TA0005)

**Platforms:** Windows, macOS, Linux

## What to Check

- [ ] Identify if Path Interception by PATH Environment Variable technique is applicable to target environment
- [ ] Check Windows systems for indicators of Path Interception by PATH Environment Variable
- [ ] Check macOS systems for indicators of Path Interception by PATH Environment Variable
- [ ] Check Linux systems for indicators of Path Interception by PATH Environment Variable
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Path Interception by PATH Environment Variable by examining the target platforms (Windows, macOS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1574.007 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1022 Restrict File and Directory Permissions

Ensure that proper permissions and directory access control are set to deny users the ability to write files to the top-level directory <code>C:</code> and system directories, such as <code>C:\Windows\</code>, to reduce places where malicious files could be placed for execution. Require that all executables be placed in write-protected directories.

### M1038 Execution Prevention

Adversaries will likely need to place new binaries in locations to be executed through this weakness. Identify and block potentially malicious software executed path interception by using application control tools, like Windows Defender Application Control, AppLocker, or Software Restriction Policies where appropriate.

### M1047 Audit

Find and eliminate path interception weaknesses in program configuration files, scripts, the PATH environment variable, services, and in shortcuts by surrounding PATH variables with quotation marks when functions allow for them. Be aware of the search order Windows uses for executing or loading binaries and use fully qualified paths wherever appropriate.

Clean up old Windows Registry keys when software is uninstalled to avoid keys with no associated legitimate binaries. Periodically search for and correct or report path interception weaknesses on systems that may have been introduced using custom or available tools that report software using insecure path configurations.

## Detection

### Detection Strategy for Hijack Execution Flow using Path Interception by PATH Environment Variable.

## Risk Assessment

| Finding                                                             | Severity | Impact      |
| ------------------------------------------------------------------- | -------- | ----------- |
| Path Interception by PATH Environment Variable technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Elastic Rules macOS launchctl 2022](https://www.elastic.co/guide/en/security/7.17/prebuilt-rule-7-16-4-modification-of-environment-variable-via-launchctl.html)
- [ExpressVPN PATH env Windows 2021](https://www.expressvpn.com/blog/cybersecurity-lessons-a-path-vulnerability-in-windows/)
- [uptycs Fake POC linux malware 2023](https://www.uptycs.com/blog/new-poc-exploit-backdoor-malware)
- [nixCraft macOS PATH variables](https://www.cyberciti.biz/faq/appleosx-bash-unix-change-set-path-environment-variable/)
- [Atomic Red Team - T1574.007](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1574.007)
- [MITRE ATT&CK - T1574.007](https://attack.mitre.org/techniques/T1574/007)
