---
name: "T1113_screen-capture"
description: "Adversaries may attempt to take screen captures of the desktop to gather information over the course of an operation."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1113
  - collection
  - linux
  - windows
  - macos
technique_id: "T1113"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Linux
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1113"
tech_stack:
  - linux
  - windows
  - macos
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1113 Screen Capture

## High-Level Description

Adversaries may attempt to take screen captures of the desktop to gather information over the course of an operation. Screen capturing functionality may be included as a feature of a remote access tool used in post-compromise operations. Taking a screenshot is also typically possible through native utilities or API calls, such as <code>CopyFromScreen</code>, <code>xwd</code>, or <code>screencapture</code>.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Linux, Windows, macOS

## What to Check

- [ ] Identify if Screen Capture technique is applicable to target environment
- [ ] Check Linux systems for indicators of Screen Capture
- [ ] Check Windows systems for indicators of Screen Capture
- [ ] Check macOS systems for indicators of Screen Capture
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Screencapture

Use screencapture command to collect a full desktop screenshot

**Supported Platforms:** macos

```bash
screencapture #{output_file}
```

### Atomic Test 2: Screencapture (silent)

Use screencapture command to collect a full desktop screenshot

**Supported Platforms:** macos

```bash
screencapture -x #{output_file}
```

### Atomic Test 3: X Windows Capture

Use xwd command to collect a full desktop screenshot and review file with xwud

**Supported Platforms:** linux

```bash
xwd -root -out #{output_file}
xwud -in #{output_file}
```

**Dependencies:**
- Package with XWD and XWUD must exist on device

### Atomic Test 4: X Windows Capture (freebsd)

Use xwd command to collect a full desktop screenshot and review file with xwud

**Supported Platforms:** linux

```bash
xwd -root -out #{output_file}
xwud -in #{output_file}
```

**Dependencies:**
- Package with XWD and XWUD must exist on device

### Atomic Test 5: Capture Linux Desktop using Import Tool

Use import command from ImageMagick to collect a full desktop screenshot

**Supported Platforms:** linux

```bash
import -window root #{output_file}
```

**Dependencies:**
- ImageMagick must be installed


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Screen Capture by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1113 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detect Screen Capture via Commands and API Calls


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Screen Capture technique applicable | Low | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [CopyFromScreen .NET](https://docs.microsoft.com/en-us/dotnet/api/system.drawing.graphics.copyfromscreen?view=netframework-4.8)
- [Antiquated Mac Malware](https://blog.malwarebytes.com/threat-analysis/2017/01/new-mac-backdoor-using-antiquated-code/)
- [Atomic Red Team - T1113](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1113)
- [MITRE ATT&CK - T1113](https://attack.mitre.org/techniques/T1113)
