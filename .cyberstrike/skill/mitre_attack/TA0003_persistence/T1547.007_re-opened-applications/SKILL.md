---
name: "T1547.007_re-opened-applications"
description: "Adversaries may modify plist files to automatically run an application when a user logs in."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1547.007
  - persistence
  - privilege-escalation
  - macos
  - sub-technique
technique_id: "T1547.007"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1547/007"
tech_stack:
  - macos
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
  - T1547.008
  - T1547.009
  - T1547.010
  - T1547.012
  - T1547.013
  - T1547.014
  - T1547.015
prerequisites:
  - T1547
severity_boost:
  T1547: "Chain with T1547 for deeper attack path"
  T1547.001: "Chain with T1547.001 for deeper attack path"
  T1547.002: "Chain with T1547.002 for deeper attack path"
---

# T1547.007 Re-opened Applications

> **Sub-technique of:** T1547

## High-Level Description

Adversaries may modify plist files to automatically run an application when a user logs in. When a user logs out or restarts via the macOS Graphical User Interface (GUI), a prompt is provided to the user with a checkbox to "Reopen windows when logging back in". When selected, all applications currently open are added to a property list file named <code>com.apple.loginwindow.[UUID].plist</code> within the <code>~/Library/Preferences/ByHost</code> directory. Applications listed in this file are automatically reopened upon the user’s next logon.

Adversaries can establish Persistence by adding a malicious application path to the <code>com.apple.loginwindow.[UUID].plist</code> file to execute payloads when a user logs in.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** macOS

## What to Check

- [ ] Identify if Re-opened Applications technique is applicable to target environment
- [ ] Check macOS systems for indicators of Re-opened Applications
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Copy in loginwindow.plist for Re-Opened Applications

Copy in new loginwindow.plist to launch Calculator.

**Supported Platforms:** macos

```bash
cp #{calc_plist_path} ~/Library/Preferences/ByHost/com.apple.loginwindow.plist
```

### Atomic Test 2: Re-Opened Applications using LoginHook

Mac Defaults

[Reference](https://developer.apple.com/library/content/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CustomLogin.html)

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo defaults write com.apple.loginwindow LoginHook #{script}
```

### Atomic Test 3: Append to existing loginwindow for Re-Opened Applications

Appends an entry to launch Calculator hidden loginwindow.\*.plist for next login.
Note that the change may not result in the added Calculator program launching on next user login.
It may depend on which version of macOS you are running on.

**Supported Platforms:** macos

```bash
FILE=`find ~/Library/Preferences/ByHost/com.apple.loginwindow.*.plist -type f | head -1`
if [ -z "${FILE}" ] ; then echo "No loginwindow plist file found" && exit 1 ; fi
echo save backup copy to /tmp/
cp ${FILE} /tmp/t1547007_loginwindow-backup.plist
echo before
plutil -p ${FILE}
echo overwriting...
#{exe_path} ${FILE} && echo after && plutil -p ${FILE}
```

**Dependencies:**

- compile C program

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Re-opened Applications by examining the target platforms (macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1547.007 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

This feature can be disabled entirely with the following terminal command: <code>defaults write -g ApplePersistence -bool no</code>.

### M1017 User Training

Holding the Shift key while logging in prevents apps from opening automatically.

## Detection

### Detect persistence via reopened application plist modification (macOS)

## Risk Assessment

| Finding                                     | Severity | Impact      |
| ------------------------------------------- | -------- | ----------- |
| Re-opened Applications technique applicable | Low      | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Re-Open windows on Mac](https://support.apple.com/en-us/HT204005)
- [Methods of Mac Malware Persistence](https://www.virusbulletin.com/uploads/pdf/conference/vb2014/VB2014-Wardle.pdf)
- [Wardle Persistence Chapter](https://taomm.org/PDFs/vol1/CH%200x02%20Persistence.pdf)
- [Atomic Red Team - T1547.007](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1547.007)
- [MITRE ATT&CK - T1547.007](https://attack.mitre.org/techniques/T1547/007)
