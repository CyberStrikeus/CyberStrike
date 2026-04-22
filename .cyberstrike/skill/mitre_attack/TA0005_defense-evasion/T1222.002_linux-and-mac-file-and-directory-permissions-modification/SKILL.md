---
name: "T1222.002_linux-and-mac-file-and-directory-permissions-modification"
description: "Adversaries may modify file or directory permissions/attributes to evade access control lists (ACLs) and access protected files."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1222.002
  - defense-evasion
  - macos
  - linux
  - sub-technique
technique_id: "T1222.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - macOS
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1222/002"
tech_stack:
  - macos
  - linux
cwe_ids:
  - CWE-693
chains_with:
  - T1222
  - T1222.001
prerequisites:
  - T1222
severity_boost:
  T1222: "Chain with T1222 for deeper attack path"
  T1222.001: "Chain with T1222.001 for deeper attack path"
---

# T1222.002 Linux and Mac File and Directory Permissions Modification

> **Sub-technique of:** T1222

## High-Level Description

Adversaries may modify file or directory permissions/attributes to evade access control lists (ACLs) and access protected files. File and directory permissions are commonly managed by ACLs configured by the file or directory owner, or users with the appropriate permissions. File and directory ACL implementations vary by platform, but generally explicitly designate which users or groups can perform which actions (read, write, execute, etc.).

Most Linux and Linux-based platforms provide a standard set of permission groups (user, group, and other) and a standard set of permissions (read, write, and execute) that are applied to each group. While nuances of each platform’s permissions implementation may vary, most of the platforms provide two primary commands used to manipulate file and directory ACLs: <code>chown</code> (short for change owner), and <code>chmod</code> (short for change mode).

Adversarial may use these commands to make themselves the owner of files and directories or change the mode if current permissions allow it. They could subsequently lock others out of the file. Specific file and directory modifications may be a required step for many techniques, such as establishing Persistence via Unix Shell Configuration Modification or tainting/hijacking other instrumental binary/configuration files via Hijack Execution Flow.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** macOS, Linux

## What to Check

- [ ] Identify if Linux and Mac File and Directory Permissions Modification technique is applicable to target environment
- [ ] Check macOS systems for indicators of Linux and Mac File and Directory Permissions Modification
- [ ] Check Linux systems for indicators of Linux and Mac File and Directory Permissions Modification
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: chmod - Change file or folder mode (numeric mode)

Changes a file or folder's permissions using chmod and a specified numeric mode.

**Supported Platforms:** linux, macos

```bash
chmod #{numeric_mode} #{file_or_folder}
```

### Atomic Test 2: chmod - Change file or folder mode (symbolic mode)

Changes a file or folder's permissions using chmod and a specified symbolic mode.

**Supported Platforms:** linux, macos

```bash
chmod #{symbolic_mode} #{file_or_folder}
```

### Atomic Test 3: chmod - Change file or folder mode (numeric mode) recursively

Changes a file or folder's permissions recursively using chmod and a specified numeric mode.

**Supported Platforms:** linux, macos

```bash
chmod -R #{numeric_mode} #{file_or_folder}
```

### Atomic Test 4: chmod - Change file or folder mode (symbolic mode) recursively

Changes a file or folder's permissions recursively using chmod and a specified symbolic mode.

**Supported Platforms:** linux, macos

```bash
chmod -R #{symbolic_mode} #{file_or_folder}
```

### Atomic Test 5: chown - Change file or folder ownership and group

Changes a file or folder's ownership and group information using chown.

**Supported Platforms:** macos, linux

```bash
chown #{owner}:#{group} #{file_or_folder}
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Linux and Mac File and Directory Permissions Modification by examining the target platforms (macOS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1222.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1022 Restrict File and Directory Permissions

Applying more restrictive permissions to files and directories could prevent adversaries from modifying the access control lists.

### M1026 Privileged Account Management

Ensure critical system files as well as those known to be abused by adversaries have restrictive permissions and are owned by an appropriately privileged account, especially if access is not required by users nor will inhibit system functionality.

## Detection

### Unix-like File Permission Manipulation Behavioral Chain Detection Strategy

## Risk Assessment

| Finding                                                                        | Severity | Impact          |
| ------------------------------------------------------------------------------ | -------- | --------------- |
| Linux and Mac File and Directory Permissions Modification technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Hybrid Analysis Icacls1 June 2018](https://www.hybrid-analysis.com/sample/ef0d2628823e8e0a0de3b08b8eacaf41cf284c086a948bdfd67f4e4373c14e4d?environmentId=100)
- [Hybrid Analysis Icacls2 May 2018](https://www.hybrid-analysis.com/sample/22dab012c3e20e3d9291bce14a2bfc448036d3b966c6e78167f4626f5f9e38d6?environmentId=110)
- [20 macOS Common Tools and Techniques](https://labs.sentinelone.com/20-common-tools-techniques-used-by-macos-threat-actors-malware/)
- [Atomic Red Team - T1222.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1222.002)
- [MITRE ATT&CK - T1222.002](https://attack.mitre.org/techniques/T1222/002)
