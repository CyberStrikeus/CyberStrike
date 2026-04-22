---
name: "T1546.002_screensaver"
description: "Adversaries may establish persistence by executing malicious content triggered by user inactivity."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1546.002
  - privilege-escalation
  - persistence
  - windows
  - sub-technique
technique_id: "T1546.002"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1546/002"
tech_stack:
  - windows
cwe_ids:
  - CWE-269
chains_with:
  - T1546
  - T1546.001
  - T1546.003
  - T1546.004
  - T1546.005
  - T1546.006
  - T1546.007
  - T1546.008
  - T1546.009
  - T1546.010
  - T1546.011
  - T1546.012
  - T1546.013
  - T1546.014
  - T1546.015
  - T1546.016
  - T1546.017
  - T1546.018
prerequisites:
  - T1546
severity_boost:
  T1546: "Chain with T1546 for deeper attack path"
  T1546.001: "Chain with T1546.001 for deeper attack path"
  T1546.003: "Chain with T1546.003 for deeper attack path"
---

# T1546.002 Screensaver

> **Sub-technique of:** T1546

## High-Level Description

Adversaries may establish persistence by executing malicious content triggered by user inactivity. Screensavers are programs that execute after a configurable time of user inactivity and consist of Portable Executable (PE) files with a .scr file extension. The Windows screensaver application scrnsave.scr is located in <code>C:\Windows\System32\</code>, and <code>C:\Windows\sysWOW64\</code> on 64-bit Windows systems, along with screensavers included with base Windows installations.

The following screensaver settings are stored in the Registry (<code>HKCU\Control Panel\Desktop\</code>) and could be manipulated to achieve persistence:

- <code>SCRNSAVE.exe</code> - set to malicious PE path
- <code>ScreenSaveActive</code> - set to '1' to enable the screensaver
- <code>ScreenSaverIsSecure</code> - set to '0' to not require a password to unlock
- <code>ScreenSaveTimeout</code> - sets user inactivity timeout before screensaver is executed

Adversaries can use screensaver settings to maintain persistence by setting the screensaver to run malware after a certain timeframe of user inactivity.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if Screensaver technique is applicable to target environment
- [ ] Check Windows systems for indicators of Screensaver
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Set Arbitrary Binary as Screensaver

This test copies a binary into the Windows System32 folder and sets it as the screensaver so it will execute for persistence. Requires a reboot and logon.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
reg export "HKEY_CURRENT_USER\Control Panel\Desktop" %userprofile%\backup.reg
copy #{input_binary} "%SystemRoot%\System32\evilscreensaver.scr"
reg.exe add "HKEY_CURRENT_USER\Control Panel\Desktop" /v ScreenSaveActive /t REG_SZ /d 1 /f
reg.exe add "HKEY_CURRENT_USER\Control Panel\Desktop" /v ScreenSaveTimeout /t REG_SZ /d 60 /f
reg.exe add "HKEY_CURRENT_USER\Control Panel\Desktop" /v ScreenSaverIsSecure /t REG_SZ /d 0 /f
reg.exe add "HKEY_CURRENT_USER\Control Panel\Desktop" /v SCRNSAVE.EXE /t REG_SZ /d "%SystemRoot%\System32\evilscreensaver.scr" /f
if #{reboot} NEQ 0 shutdown /r /t 0
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Screensaver by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1546.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention

Block .scr files from being executed from non-standard locations.

### M1042 Disable or Remove Feature or Program

Use Group Policy to disable screensavers if they are unnecessary.

## Detection

### Detect Screensaver-Based Persistence via Registry and Execution Chains

## Risk Assessment

| Finding                          | Severity | Impact               |
| -------------------------------- | -------- | -------------------- |
| Screensaver technique applicable | Low      | Privilege Escalation |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-269 | Improper Privilege Management |

## References

- [ESET Gazer Aug 2017](https://www.welivesecurity.com/wp-content/uploads/2017/08/eset-gazer.pdf)
- [Wikipedia Screensaver](https://en.wikipedia.org/wiki/Screensaver)
- [Atomic Red Team - T1546.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1546.002)
- [MITRE ATT&CK - T1546.002](https://attack.mitre.org/techniques/T1546/002)
