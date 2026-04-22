---
name: "T1036.012_browser-fingerprint"
description: "Adversaries may attempt to blend in with legitimate traffic by spoofing browser and system attributes like operating system, system language, platform, user-agent string, resolution, time zone, etc."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1036.012
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1036.012"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1036/012"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1036
  - T1036.001
  - T1036.002
  - T1036.003
  - T1036.004
  - T1036.005
  - T1036.006
  - T1036.007
  - T1036.008
  - T1036.009
  - T1036.010
  - T1036.011
prerequisites:
  - T1036
severity_boost:
  T1036: "Chain with T1036 for deeper attack path"
  T1036.001: "Chain with T1036.001 for deeper attack path"
  T1036.002: "Chain with T1036.002 for deeper attack path"
---

# T1036.012 Browser Fingerprint

> **Sub-technique of:** T1036

## High-Level Description

Adversaries may attempt to blend in with legitimate traffic by spoofing browser and system attributes like operating system, system language, platform, user-agent string, resolution, time zone, etc. The HTTP User-Agent request header is a string that lets servers and network peers identify the application, operating system, vendor, and/or version of the requesting user agent.

Adversaries may gather this information through System Information Discovery or by users navigating to adversary-controlled websites, and then use that information to craft their web traffic to evade defenses.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Browser Fingerprint technique is applicable to target environment
- [ ] Check Linux systems for indicators of Browser Fingerprint
- [ ] Check macOS systems for indicators of Browser Fingerprint
- [ ] Check Windows systems for indicators of Browser Fingerprint
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Browser Fingerprint by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1036.012 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1047 Audit

Review and limit the fingerprinting surface to only necessary information on each browser to make the browser less unique. For example, the available fonts may be limited to a standard font list.

## Detection

### Detection of Spoofed User-Agent

## Risk Assessment

| Finding                                  | Severity | Impact          |
| ---------------------------------------- | -------- | --------------- |
| Browser Fingerprint technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Mozilla User Agent](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/User-Agent)
- [Gummy Browsers: Targeted Browser Spoofing against State-of-the-Art Fingerprinting Techniques](https://arxiv.org/pdf/2110.10129)
- [Atomic Red Team - T1036.012](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1036.012)
- [MITRE ATT&CK - T1036.012](https://attack.mitre.org/techniques/T1036/012)
