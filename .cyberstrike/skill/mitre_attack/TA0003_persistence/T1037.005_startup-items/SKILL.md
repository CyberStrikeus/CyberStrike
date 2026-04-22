---
name: "T1037.005_startup-items"
description: "Adversaries may use startup items automatically executed at boot initialization to establish persistence."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1037.005
  - persistence
  - privilege-escalation
  - macos
  - sub-technique
technique_id: "T1037.005"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1037/005"
tech_stack:
  - macos
cwe_ids:
  - CWE-276
chains_with:
  - T1037
  - T1037.001
  - T1037.002
  - T1037.003
  - T1037.004
prerequisites:
  - T1037
severity_boost:
  T1037: "Chain with T1037 for deeper attack path"
  T1037.001: "Chain with T1037.001 for deeper attack path"
  T1037.002: "Chain with T1037.002 for deeper attack path"
---

# T1037.005 Startup Items

> **Sub-technique of:** T1037

## High-Level Description

Adversaries may use startup items automatically executed at boot initialization to establish persistence. Startup items execute during the final phase of the boot process and contain shell scripts or other executable files along with configuration information used by the system to determine the execution order for all startup items.

This is technically a deprecated technology (superseded by Launch Daemon), and thus the appropriate folder, <code>/Library/StartupItems</code> isn’t guaranteed to exist on the system by default, but does appear to exist by default on macOS Sierra. A startup item is a directory whose executable and configuration property list (plist), <code>StartupParameters.plist</code>, reside in the top-level directory. 

An adversary can create the appropriate folders/files in the StartupItems directory to register their own persistence mechanism. Additionally, since StartupItems run during the bootup phase of macOS, they will run as the elevated root user.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** macOS

## What to Check

- [ ] Identify if Startup Items technique is applicable to target environment
- [ ] Check macOS systems for indicators of Startup Items
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Add file to Local Library StartupItems

Modify or create an file in /Library/StartupItems
[Reference](https://www.alienvault.com/blogs/labs-research/diversity-in-recent-mac-malware)

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo touch /Library/StartupItems/EvilStartup.plist
```

### Atomic Test 2: Add launch script to launch daemon

Add launch script to /Library/StartupItems to launch agent
[Example](https://cybersecurity.att.com/blogs/labs-research/diversity-in-recent-mac-malware)

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo cp #{path_startup_params} /Library/StartupItems/StartupParameters.plist
sudo cp #{path_malicious_script} /Library/StartupItems/atomic.sh
sudo cp #{path_malicious_plist} /tmp/T1037_005_daemon.plist
sudo /Library/StartupItems/atomic.sh start
```

**Dependencies:**
- /Library/StartupItems must exist
- The shared library must exist on disk at specified location (#{path_malicious_plist})
- The startup script must exist on disk at specified location (#{path_malicious_script})

### Atomic Test 3: Add launch script to launch agent

Add launch script to /Library/StartupItems to launch agent
[Example](https://cybersecurity.att.com/blogs/labs-research/diversity-in-recent-mac-malware)

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo cp #{path_startup_params} /Library/StartupItems/StartupParameters.plist
sudo cp #{path_malicious_script} /Library/StartupItems/atomic.sh
sudo cp #{path_malicious_plist} /tmp/T1037_005_agent.plist
/Library/StartupItems/atomic.sh start
```

**Dependencies:**
- /Library/StartupItems must exist
- The shared library must exist on disk at specified location (#{path_malicious_plist})
- The startup script must exist on disk at specified location (#{path_malicious_script})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Startup Items by examining the target platforms (macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1037.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1022 Restrict File and Directory Permissions
Since StartupItems are deprecated, preventing all users from writing to the <code>/Library/StartupItems</code> directory would prevent any startup items from getting registered.


## Detection

### Detect Modification of macOS Startup Items


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Startup Items technique applicable | Low | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Startup Items](https://developer.apple.com/library/content/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/StartupItems.html)
- [Methods of Mac Malware Persistence](https://www.virusbulletin.com/uploads/pdf/conference/vb2014/VB2014-Wardle.pdf)
- [Atomic Red Team - T1037.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1037.005)
- [MITRE ATT&CK - T1037.005](https://attack.mitre.org/techniques/T1037/005)
