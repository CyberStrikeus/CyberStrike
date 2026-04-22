---
name: "T1543.004_launch-daemon"
description: "Adversaries may create or modify Launch Daemons to execute malicious payloads as part of persistence."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1543.004
  - persistence
  - privilege-escalation
  - macos
  - sub-technique
technique_id: "T1543.004"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1543/004"
tech_stack:
  - macos
cwe_ids:
  - CWE-276
chains_with:
  - T1543
  - T1543.001
  - T1543.002
  - T1543.003
  - T1543.005
prerequisites:
  - T1543
severity_boost:
  T1543: "Chain with T1543 for deeper attack path"
  T1543.001: "Chain with T1543.001 for deeper attack path"
  T1543.002: "Chain with T1543.002 for deeper attack path"
---

# T1543.004 Launch Daemon

> **Sub-technique of:** T1543

## High-Level Description

Adversaries may create or modify Launch Daemons to execute malicious payloads as part of persistence. Launch Daemons are plist files used to interact with Launchd, the service management framework used by macOS. Launch Daemons require elevated privileges to install, are executed for every user on a system prior to login, and run in the background without the need for user interaction. During the macOS initialization startup, the launchd process loads the parameters for launch-on-demand system-level daemons from plist files found in <code>/System/Library/LaunchDaemons/</code> and <code>/Library/LaunchDaemons/</code>. Required Launch Daemons parameters include a <code>Label</code> to identify the task, <code>Program</code> to provide a path to the executable, and <code>RunAtLoad</code> to specify when the task is run. Launch Daemons are often used to provide access to shared resources, updates to software, or conduct automation tasks.

Adversaries may install a Launch Daemon configured to execute at startup by using the <code>RunAtLoad</code> parameter set to <code>true</code> and the <code>Program</code> parameter set to the malicious executable path. The daemon name may be disguised by using a name from a related operating system or benign software (i.e. Masquerading). When the Launch Daemon is executed, the program inherits administrative permissions.

Additionally, system configuration changes (such as the installation of third party package managing software) may cause folders such as <code>usr/local/bin</code> to become globally writeable. So, it is possible for poor configurations to allow an adversary to modify executables referenced by current Launch Daemon's plist files.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** macOS

## What to Check

- [ ] Identify if Launch Daemon technique is applicable to target environment
- [ ] Check macOS systems for indicators of Launch Daemon
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Launch Daemon

Utilize LaunchDaemon to launch `Hello World`

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo cp #{path_malicious_plist} /Library/LaunchDaemons/#{plist_filename}
sudo launchctl load -w /Library/LaunchDaemons/#{plist_filename}
```

**Dependencies:**
- The shared library must exist on disk at specified location (#{path_malicious_plist})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Launch Daemon by examining the target platforms (macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1543.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1018 User Account Management
Limit privileges of user accounts and remediate Privilege Escalation vectors so only authorized administrators can create new Launch Daemons.

### M1047 Audit
Use auditing tools capable of detecting folder permissions abuse opportunities on systems, especially reviewing changes made to folders by third-party software.


## Detection

### Detection Strategy for Launch Daemon Creation or Modification (macOS)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Launch Daemon technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [AppleDocs Launch Agent Daemons](https://developer.apple.com/library/content/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
- [LaunchDaemon Hijacking](https://bradleyjkemp.dev/post/launchdaemon-hijacking/)
- [WireLurker](https://www.paloaltonetworks.com/content/dam/pan/en_US/assets/pdf/reports/Unit_42/unit42-wirelurker.pdf)
- [launchd Keywords for plists](https://www.real-world-systems.com/docs/launchdPlist.1.html)
- [Methods of Mac Malware Persistence](https://www.virusbulletin.com/uploads/pdf/conference/vb2014/VB2014-Wardle.pdf)
- [OSX Malware Detection](https://papers.put.as/papers/macosx/2016/RSA_OSX_Malware.pdf)
- [sentinelone macos persist Jun 2019](https://www.sentinelone.com/blog/how-malware-persists-on-macos/)
- [Atomic Red Team - T1543.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1543.004)
- [MITRE ATT&CK - T1543.004](https://attack.mitre.org/techniques/T1543/004)
