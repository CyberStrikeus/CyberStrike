---
name: "T1564.014_extended-attributes"
description: "Adversaries may abuse extended attributes (xattrs) on macOS and Linux to hide their malicious data in order to evade detection."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1564.014
  - defense-evasion
  - linux
  - macos
  - sub-technique
technique_id: "T1564.014"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1564/014"
tech_stack:
  - linux
  - macos
cwe_ids:
  - CWE-693
chains_with:
  - T1564
  - T1564.001
  - T1564.002
  - T1564.003
  - T1564.004
  - T1564.005
  - T1564.006
  - T1564.007
  - T1564.008
  - T1564.009
  - T1564.010
  - T1564.011
  - T1564.012
  - T1564.013
prerequisites:
  - T1564
severity_boost:
  T1564: "Chain with T1564 for deeper attack path"
  T1564.001: "Chain with T1564.001 for deeper attack path"
  T1564.002: "Chain with T1564.002 for deeper attack path"
---

# T1564.014 Extended Attributes

> **Sub-technique of:** T1564

## High-Level Description

Adversaries may abuse extended attributes (xattrs) on macOS and Linux to hide their malicious data in order to evade detection. Extended attributes are key-value pairs of file and directory metadata used by both macOS and Linux. They are not visible through standard tools like `Finder`, `ls`, or `cat` and require utilities such as `xattr` (macOS) or `getfattr` (Linux) for inspection. Operating systems and applications use xattrs for tagging, integrity checks, and access control. On Linux, xattrs are organized into namespaces such as `user.` (user permissions), `trusted.` (root permissions), `security.`, and `system.`, each with specific permissions. On macOS, xattrs are flat strings without namespace prefixes, commonly prefixed with `com.apple.*` (e.g., `com.apple.quarantine`, `com.apple.metadata:_kMDItemUserTags`) and used by system features like Gatekeeper and Spotlight.

An adversary may leverage xattrs by embedding a second-stage payload into the extended attribute of a legitimate file. On macOS, a payload can be embedded into a custom attribute using the `xattr` command. A separate loader can retrieve the attribute with `xattr -p`, decode the content, and execute it using a scripting interpreter. On Linux, an adversary may use `setfattr` to write a payload into the `user.` namespace of a legitimate file. A loader script can later extract the payload with `getfattr --only-values`, decode it, and execute it using bash or another interpreter. In both cases, because the primary file content remains unchanged, security tools and integrity checks that do not inspect extended attributes will observe the original file hash, allowing the malicious payload to evade detection.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS

## What to Check

- [ ] Identify if Extended Attributes technique is applicable to target environment
- [ ] Check Linux systems for indicators of Extended Attributes
- [ ] Check macOS systems for indicators of Extended Attributes
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Extended Attributes by examining the target platforms (Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1564.014 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint
During artifact review, packaging, or deployment stages, scan extended attributes alongside file contents to detect hidden payloads, obfuscated data, or suspicious attribute keys that may indicate malicious behavior.


## Detection

### Detection Strategy for Extended Attributes Abuse


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Extended Attributes technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Establishing persistence using extended attributes on Linux](https://kernal.eu/posts/linux-xattr-persistence/)
- [Low GroupIB xattrs nov 2024](https://www.group-ib.com/blog/stealthy-attributes-of-apt-lazarus/)
- [Atomic Red Team - T1564.014](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1564.014)
- [MITRE ATT&CK - T1564.014](https://attack.mitre.org/techniques/T1564/014)
