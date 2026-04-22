---
name: "T1123_audio-capture"
description: "An adversary can leverage a computer's peripheral devices (e.g., microphones and webcams) or applications (e.g., voice and video call services) to capture audio recordings for the purpose of listen..."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1123
  - collection
  - linux
  - macos
  - windows
technique_id: "T1123"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1123"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1123 Audio Capture

## High-Level Description

An adversary can leverage a computer's peripheral devices (e.g., microphones and webcams) or applications (e.g., voice and video call services) to capture audio recordings for the purpose of listening into sensitive conversations to gather information.

Malware or scripts may be used to interact with the devices through an available API provided by the operating system or an application to capture audio. Audio files may be written to disk and exfiltrated later.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Audio Capture technique is applicable to target environment
- [ ] Check Linux systems for indicators of Audio Capture
- [ ] Check macOS systems for indicators of Audio Capture
- [ ] Check Windows systems for indicators of Audio Capture
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: using device audio capture commandlet

Uses AudioDeviceCmdlets to set the default recording device and simulate audio capture.
Module repo: [AudioDeviceCmdlets](https://github.com/frgnca/AudioDeviceCmdlets)

**Supported Platforms:** windows

```powershell
$mic = Get-AudioDevice -Recording
Set-AudioDevice -ID $mic.ID
Start-Sleep -Seconds 5
```

**Dependencies:**

- AudioDeviceCmdlets module must be installed

### Atomic Test 2: Registry artefact when application use microphone

[can-you-track-processes-accessing-the-camera-and-microphone](https://svch0st.medium.com/can-you-track-processes-accessing-the-camera-and-microphone-7e6885b37072)

**Supported Platforms:** windows

```cmd
reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone\NonPackaged\C:#Windows#Temp#atomic.exe /v LastUsedTimeStart /t REG_BINARY /d a273b6f07104d601 /f
reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone\NonPackaged\C:#Windows#Temp#atomic.exe /v LastUsedTimeStop /t REG_BINARY /d 96ef514b7204d601 /f
```

### Atomic Test 3: using Quicktime Player

Use AppleScript to get Quicktime Player to record an audio file from the default microphone.

Should create a non-empty m4a file with sound from the microphone.

- requires Automation permissions but no additional microphone permissions
- saves file in /tmp by default. Other locations likely to require more permissions.

**Supported Platforms:** macos

```bash
sh #{filename} #{audiofile} #{duration}
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Audio Capture by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1123 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Behavioral Detection Strategy for T1123 Audio Capture Across Windows, Linux, macOS

## Risk Assessment

| Finding                            | Severity | Impact     |
| ---------------------------------- | -------- | ---------- |
| Audio Capture technique applicable | Low      | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [ESET Attor Oct 2019](https://www.welivesecurity.com/wp-content/uploads/2019/10/ESET_Attor.pdf)
- [Atomic Red Team - T1123](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1123)
- [MITRE ATT&CK - T1123](https://attack.mitre.org/techniques/T1123)
