---
name: "T1036.002_right-to-left-override"
description: "Adversaries may abuse the right-to-left override (RTLO or RLO) character (U+202E) to disguise a string and/or file name to make it appear benign."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1036.002
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1036.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1036/002"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1036
  - T1036.001
  - T1036.003
  - T1036.004
  - T1036.005
  - T1036.006
  - T1036.007
  - T1036.008
  - T1036.009
  - T1036.010
  - T1036.011
  - T1036.012
prerequisites:
  - T1036
severity_boost:
  T1036: "Chain with T1036 for deeper attack path"
  T1036.001: "Chain with T1036.001 for deeper attack path"
  T1036.003: "Chain with T1036.003 for deeper attack path"
---

# T1036.002 Right-to-Left Override

> **Sub-technique of:** T1036

## High-Level Description

Adversaries may abuse the right-to-left override (RTLO or RLO) character (U+202E) to disguise a string and/or file name to make it appear benign. RTLO is a non-printing Unicode character that causes the text that follows it to be displayed in reverse. For example, a Windows screensaver executable named <code>March 25 \u202Excod.scr</code> will display as <code>March 25 rcs.docx</code>. A JavaScript file named <code>photo_high_re\u202Egnp.js</code> will be displayed as <code>photo_high_resj.png</code>.

Adversaries may abuse the RTLO character as a means of tricking a user into executing what they think is a benign file type. A common use of this technique is with Spearphishing Attachment/Malicious File since it can trick both end users and defenders if they are not aware of how their tools display and render the RTLO character. Use of the RTLO character has been seen in many targeted intrusion attempts and criminal activity. RTLO can be used in the Windows Registry as well, where regedit.exe displays the reversed characters but the command line tool reg.exe does not by default.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Right-to-Left Override technique is applicable to target environment
- [ ] Check Linux systems for indicators of Right-to-Left Override
- [ ] Check macOS systems for indicators of Right-to-Left Override
- [ ] Check Windows systems for indicators of Right-to-Left Override
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Right-to-Left Override by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1036.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Right-to-Left Override Masquerading Detection via Filename and Execution Context


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Right-to-Left Override technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Trend Micro PLEAD RTLO](https://blog.trendmicro.com/trendlabs-security-intelligence/plead-targeted-attacks-against-taiwanese-government-agencies-2/)
- [Kaspersky RTLO Cyber Crime](https://securelist.com/zero-day-vulnerability-in-telegram/83800/)
- [Infosecinstitute RTLO Technique](https://resources.infosecinstitute.com/spoof-using-right-to-left-override-rtlo-technique-2/)
- [Atomic Red Team - T1036.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1036.002)
- [MITRE ATT&CK - T1036.002](https://attack.mitre.org/techniques/T1036/002)
