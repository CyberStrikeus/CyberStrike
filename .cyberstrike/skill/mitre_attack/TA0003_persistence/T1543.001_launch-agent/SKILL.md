---
name: "T1543.001_launch-agent"
description: "Adversaries may create or modify launch agents to repeatedly execute malicious payloads as part of persistence."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1543.001
  - persistence
  - privilege-escalation
  - macos
  - sub-technique
technique_id: "T1543.001"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1543/001"
tech_stack:
  - macos
cwe_ids:
  - CWE-276
chains_with:
  - T1543
  - T1543.002
  - T1543.003
  - T1543.004
  - T1543.005
prerequisites:
  - T1543
severity_boost:
  T1543: "Chain with T1543 for deeper attack path"
  T1543.002: "Chain with T1543.002 for deeper attack path"
  T1543.003: "Chain with T1543.003 for deeper attack path"
---

# T1543.001 Launch Agent

> **Sub-technique of:** T1543

## High-Level Description

Adversaries may create or modify launch agents to repeatedly execute malicious payloads as part of persistence. When a user logs in, a per-user launchd process is started which loads the parameters for each launch-on-demand user agent from the property list (.plist) file found in <code>/System/Library/LaunchAgents</code>, <code>/Library/LaunchAgents</code>, and <code>~/Library/LaunchAgents</code>. Property list files use the <code>Label</code>, <code>ProgramArguments </code>, and <code>RunAtLoad</code> keys to identify the Launch Agent's name, executable location, and execution time. Launch Agents are often installed to perform updates to programs, launch user specified programs at login, or to conduct other developer tasks.

 Launch Agents can also be executed using the Launchctl command.
 
Adversaries may install a new Launch Agent that executes at login by placing a .plist file into the appropriate folders with the <code>RunAtLoad</code> or <code>KeepAlive</code> keys set to <code>true</code>. The Launch Agent name may be disguised by using a name from the related operating system or benign software. Launch Agents are created with user level privileges and execute with user level permissions.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** macOS

## What to Check

- [ ] Identify if Launch Agent technique is applicable to target environment
- [ ] Check macOS systems for indicators of Launch Agent
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Launch Agent

Create a plist and execute it

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
if [ ! -d ~/Library/LaunchAgents ]; then mkdir ~/Library/LaunchAgents; fi;
sudo cp #{path_malicious_plist} ~/Library/LaunchAgents/#{plist_filename}
sudo launchctl load -w ~/Library/LaunchAgents/#{plist_filename}
```

**Dependencies:**
- The shared library must exist on disk at specified location (#{path_malicious_plist})

### Atomic Test 2: Event Monitor Daemon Persistence

This test adds persistence via a plist to execute via the macOS Event Monitor Daemon.

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo cp #{script_location} #{script_destination}
sudo touch /private/var/db/emondClients/#{empty_file}
```

### Atomic Test 3: Launch Agent - Root Directory

Create a plist and execute it

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo cp #{path_malicious_plist} /Library/LaunchAgents/#{plist_filename}
launchctl load -w /Library/LaunchAgents/#{plist_filename}
```

**Dependencies:**
- /Library/LaunchAgents must exist
- The shared library must exist on disk at specified location (#{path_malicious_plist})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Launch Agent by examining the target platforms (macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1543.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1022 Restrict File and Directory Permissions
Set group policies to restrict file permissions to the <code>~/launchagents</code> folder.


## Detection

### Detection of Launch Agent Creation or Modification on macOS


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Launch Agent technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [AppleDocs Launch Agent Daemons](https://developer.apple.com/library/content/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
- [Sofacy Komplex Trojan](https://researchcenter.paloaltonetworks.com/2016/09/unit42-sofacys-komplex-os-x-trojan/)
- [OceanLotus for OS X](https://www.alienvault.com/blogs/labs-research/oceanlotus-for-os-x-an-application-bundle-pretending-to-be-an-adobe-flash-update)
- [OSX Keydnap malware](https://www.welivesecurity.com/2016/07/06/new-osxkeydnap-malware-hungry-credentials/)
- [Methods of Mac Malware Persistence](https://www.virusbulletin.com/uploads/pdf/conference/vb2014/VB2014-Wardle.pdf)
- [OSX Malware Detection](https://papers.put.as/papers/macosx/2016/RSA_OSX_Malware.pdf)
- [Antiquated Mac Malware](https://blog.malwarebytes.com/threat-analysis/2017/01/new-mac-backdoor-using-antiquated-code/)
- [OSX.Dok Malware](https://blog.malwarebytes.com/threat-analysis/2017/04/new-osx-dok-malware-intercepts-web-traffic/)
- [Atomic Red Team - T1543.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1543.001)
- [MITRE ATT&CK - T1543.001](https://attack.mitre.org/techniques/T1543/001)
