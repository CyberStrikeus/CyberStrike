---
name: "T1056.002_gui-input-capture"
description: "Adversaries may mimic common operating system GUI components to prompt users for credentials with a seemingly legitimate prompt."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1056.002
  - collection
  - credential-access
  - macos
  - windows
  - linux
  - sub-technique
technique_id: "T1056.002"
tactic: "collection"
all_tactics:
  - collection
  - credential-access
platforms:
  - macOS
  - Windows
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1056/002"
tech_stack:
  - macos
  - windows
  - linux
cwe_ids:
  - CWE-200
chains_with:
  - T1056
  - T1056.001
  - T1056.003
  - T1056.004
prerequisites:
  - T1056
severity_boost:
  T1056: "Chain with T1056 for deeper attack path"
  T1056.001: "Chain with T1056.001 for deeper attack path"
  T1056.003: "Chain with T1056.003 for deeper attack path"
---

# T1056.002 GUI Input Capture

> **Sub-technique of:** T1056

## High-Level Description

Adversaries may mimic common operating system GUI components to prompt users for credentials with a seemingly legitimate prompt. When programs are executed that need additional privileges than are present in the current user context, it is common for the operating system to prompt the user for proper credentials to authorize the elevated privileges for the task (ex: Bypass User Account Control).

Adversaries may mimic this functionality to prompt users for credentials with a seemingly legitimate prompt for a number of reasons that mimic normal usage, such as a fake installer requiring additional access or a fake malware removal suite. This type of prompt can be used to collect credentials via various languages such as AppleScript and PowerShell. On Linux systems adversaries may launch dialog boxes prompting users for credentials from malicious shell scripts or the command line (i.e. Unix Shell).

Adversaries may also mimic common software authentication requests, such as those from browsers or email clients. This may also be paired with user activity monitoring (i.e., Browser Information Discovery and/or Application Window Discovery) to spoof prompts when users are naturally accessing sensitive sites/data.

## Kill Chain Phase

- Collection (TA0009)
- Credential Access (TA0006)

**Platforms:** macOS, Windows, Linux

## What to Check

- [ ] Identify if GUI Input Capture technique is applicable to target environment
- [ ] Check macOS systems for indicators of GUI Input Capture
- [ ] Check Windows systems for indicators of GUI Input Capture
- [ ] Check Linux systems for indicators of GUI Input Capture
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: AppleScript - Prompt User for Password

Prompt User for Password (Local Phishing)
Reference: http://fuzzynop.blogspot.com/2014/10/osascript-for-local-phishing.html

**Supported Platforms:** macos

```bash
osascript -e 'tell app "System Preferences" to activate' -e 'tell app "System Preferences" to activate' -e 'tell app "System Preferences" to display dialog "Software Update requires that you type your password to apply changes." & return & return  default answer "" with icon 1 with hidden answer with title "Software Update"'
```

### Atomic Test 2: PowerShell - Prompt User for Password

Prompt User for Password (Local Phishing) as seen in Stitch RAT. Upon execution, a window will appear for the user to enter their credentials.

Reference: https://github.com/nathanlopez/Stitch/blob/master/PyLib/askpass.py

**Supported Platforms:** windows

```powershell
# Creates GUI to prompt for password. Expect long pause before prompt is available.
$cred = $host.UI.PromptForCredential('Windows Security Update', '',[Environment]::UserName, [Environment]::UserDomainName)
# Using write-warning to allow message to show on console as echo and other similar commands are not visable from the Invoke-AtomicTest framework.
write-warning $cred.GetNetworkCredential().Password
```

### Atomic Test 3: AppleScript - Spoofing a credential prompt using osascript

Prompt user for password without requiring permissions to send Apple events to System Settings.
https://embracethered.com/blog/posts/2021/spoofing-credential-dialogs/

**Supported Platforms:** macos

```bash
PWD_SPOOF=$(osascript -e 'display dialog "To perform a security update MacOS needs your passphrase." with title "MacOS Security Update" default answer "" with icon stop with hidden answer')
echo $PWD_SPOOF
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to GUI Input Capture by examining the target platforms (macOS, Windows, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1056.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1017 User Training

Use user training as a way to bring awareness and raise suspicion for potentially malicious events and dialog boxes (ex: Office documents prompting for credentials).

## Detection

### Behavioral Detection of Spoofed GUI Credential Prompts

## Risk Assessment

| Finding                                | Severity | Impact     |
| -------------------------------------- | -------- | ---------- |
| GUI Input Capture technique applicable | High     | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [LogRhythm Do You Trust Oct 2014](https://logrhythm.com/blog/do-you-trust-your-computer/)
- [Spoofing credential dialogs](https://embracethered.com/blog/posts/2021/spoofing-credential-dialogs/)
- [OSX Keydnap malware](https://www.welivesecurity.com/2016/07/06/new-osxkeydnap-malware-hungry-credentials/)
- [Enigma Phishing for Credentials Jan 2015](https://enigma0x3.net/2015/01/21/phishing-for-credentials-if-you-want-it-just-ask/)
- [OSX Malware Exploits MacKeeper](https://baesystemsai.blogspot.com/2015/06/new-mac-os-malware-exploits-mackeeper.html)
- [Atomic Red Team - T1056.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1056.002)
- [MITRE ATT&CK - T1056.002](https://attack.mitre.org/techniques/T1056/002)
