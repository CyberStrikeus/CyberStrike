---
name: "T1125_video-capture"
description: "An adversary can leverage a computer's peripheral devices (e.g., integrated cameras or webcams) or applications (e.g., video call services) to capture video recordings for the purpose of gathering ..."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1125
  - collection
  - windows
  - macos
  - linux
technique_id: "T1125"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Windows
  - macOS
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1125"
tech_stack:
  - windows
  - macos
  - linux
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1125 Video Capture

## High-Level Description

An adversary can leverage a computer's peripheral devices (e.g., integrated cameras or webcams) or applications (e.g., video call services) to capture video recordings for the purpose of gathering information. Images may also be captured from devices or applications, potentially in specified intervals, in lieu of video files.

Malware or scripts may be used to interact with the devices through an available API provided by the operating system or an application to capture video or images. Video or image files may be written to disk and exfiltrated later. This technique differs from Screen Capture due to use of specific devices or applications for video recording rather than capturing the victim's screen.

In macOS, there are a few different malware samples that record the user's webcam such as FruitFly and Proton.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Windows, macOS, Linux

## What to Check

- [ ] Identify if Video Capture technique is applicable to target environment
- [ ] Check Windows systems for indicators of Video Capture
- [ ] Check macOS systems for indicators of Video Capture
- [ ] Check Linux systems for indicators of Video Capture
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Registry artefact when application use webcam

[can-you-track-processes-accessing-the-camera-and-microphone](https://svch0st.medium.com/can-you-track-processes-accessing-the-camera-and-microphone-7e6885b37072)

**Supported Platforms:** windows

```cmd
reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam\NonPackaged\C:#Windows#Temp#atomic.exe /v LastUsedTimeStart /t REG_BINARY /d a273b6f07104d601 /f
reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam\NonPackaged\C:#Windows#Temp#atomic.exe /v LastUsedTimeStop /t REG_BINARY /d 96ef514b7204d601 /f
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Video Capture by examining the target platforms (Windows, macOS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1125 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Behavior-chain, platform-aware detection strategy for T1125 Video Capture

## Risk Assessment

| Finding                            | Severity | Impact     |
| ---------------------------------- | -------- | ---------- |
| Video Capture technique applicable | Low      | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [objective-see 2017 review](https://objective-see.com/blog/blog_0x25.html)
- [Atomic Red Team - T1125](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1125)
- [MITRE ATT&CK - T1125](https://attack.mitre.org/techniques/T1125)
