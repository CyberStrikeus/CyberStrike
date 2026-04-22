---
name: "T1547.013_xdg-autostart-entries"
description: "Adversaries may add or modify XDG Autostart Entries to execute malicious programs or commands when a user’s desktop environment is loaded at login."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1547.013
  - persistence
  - privilege-escalation
  - linux
  - sub-technique
technique_id: "T1547.013"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1547/013"
tech_stack:
  - linux
cwe_ids:
  - CWE-276
chains_with:
  - T1547
  - T1547.001
  - T1547.002
  - T1547.003
  - T1547.004
  - T1547.005
  - T1547.006
  - T1547.007
  - T1547.008
  - T1547.009
  - T1547.010
  - T1547.012
  - T1547.014
  - T1547.015
prerequisites:
  - T1547
severity_boost:
  T1547: "Chain with T1547 for deeper attack path"
  T1547.001: "Chain with T1547.001 for deeper attack path"
  T1547.002: "Chain with T1547.002 for deeper attack path"
---

# T1547.013 XDG Autostart Entries

> **Sub-technique of:** T1547

## High-Level Description

Adversaries may add or modify XDG Autostart Entries to execute malicious programs or commands when a user’s desktop environment is loaded at login. XDG Autostart entries are available for any XDG-compliant Linux system. XDG Autostart entries use Desktop Entry files (`.desktop`) to configure the user’s desktop environment upon user login. These configuration files determine what applications launch upon user login, define associated applications to open specific file types, and define applications used to open removable media.

Adversaries may abuse this feature to establish persistence by adding a path to a malicious binary or command to the `Exec` directive in the `.desktop` configuration file. When the user’s desktop environment is loaded at user login, the `.desktop` files located in the XDG Autostart directories are automatically executed. System-wide Autostart entries are located in the `/etc/xdg/autostart` directory while the user entries are located in the `~/.config/autostart` directory.

Adversaries may combine this technique with Masquerading to blend malicious Autostart entries with legitimate programs.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Linux

## What to Check

- [ ] Identify if XDG Autostart Entries technique is applicable to target environment
- [ ] Check Linux systems for indicators of XDG Autostart Entries
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to XDG Autostart Entries by examining the target platforms (Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1547.013 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1022 Restrict File and Directory Permissions

Restrict write access to XDG autostart entries to only select privileged users.

### M1018 User Account Management

Limit privileges of user accounts so only authorized privileged users can create and modify XDG autostart entries.

### M1033 Limit Software Installation

Restrict software installation to trusted repositories only and be cautious of orphaned software packages.

## Detection

### Linux Detection Strategy for T1547.013 - XDG Autostart Entries

## Risk Assessment

| Finding                                    | Severity | Impact      |
| ------------------------------------------ | -------- | ----------- |
| XDG Autostart Entries technique applicable | Low      | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Free Desktop Application Autostart Feb 2006](https://specifications.freedesktop.org/autostart-spec/autostart-spec-latest.html)
- [Free Desktop Entry Keys](https://specifications.freedesktop.org/desktop-entry-spec/latest/recognized-keys.html)
- [Red Canary Netwire Linux 2022](https://redcanary.com/blog/netwire-remote-access-trojan-on-linux/)
- [Atomic Red Team - T1547.013](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1547.013)
- [MITRE ATT&CK - T1547.013](https://attack.mitre.org/techniques/T1547/013)
