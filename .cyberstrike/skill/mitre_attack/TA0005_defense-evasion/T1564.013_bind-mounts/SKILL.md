---
name: "T1564.013_bind-mounts"
description: "Adversaries may abuse bind mounts on file structures to hide their activity and artifacts from native utilities."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1564.013
  - defense-evasion
  - linux
  - sub-technique
technique_id: "T1564.013"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1564/013"
tech_stack:
  - linux
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
  - T1564.014
prerequisites:
  - T1564
severity_boost:
  T1564: "Chain with T1564 for deeper attack path"
  T1564.001: "Chain with T1564.001 for deeper attack path"
  T1564.002: "Chain with T1564.002 for deeper attack path"
---

# T1564.013 Bind Mounts

> **Sub-technique of:** T1564

## High-Level Description

Adversaries may abuse bind mounts on file structures to hide their activity and artifacts from native utilities. A bind mount maps a directory or file from one location on the filesystem to another, similar to a shortcut on Windows. It’s commonly used to provide access to specific files or directories across different environments, such as inside containers or chroot environments, and requires sudo access.

Adversaries may use bind mounts to map either an empty directory or a benign `/proc` directory to a malicious process’s `/proc` directory. Using the commands `mount –o bind /proc/benign-process /proc/malicious-process` (or `mount –B`), the malicious process's `/proc` directory is overlayed with the contents of a benign process's `/proc` directory. When system utilities query process activity, such as `ps` and `top`, the kernel follows the bind mount and presents the benign directory’s contents instead of the malicious process's actual `/proc` directory. As a result, these utilities display information that appears to come from the benign process, effectively hiding the malicious process's metadata, executable, or other artifacts from detection.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux

## What to Check

- [ ] Identify if Bind Mounts technique is applicable to target environment
- [ ] Check Linux systems for indicators of Bind Mounts
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Bind Mounts by examining the target platforms (Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1564.013 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Bind Mounts on Linux

## Risk Assessment

| Finding                          | Severity | Impact          |
| -------------------------------- | -------- | --------------- |
| Bind Mounts technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Ahn Lab CoinMiner 2023](https://asec.ahnlab.com/en/51908/)
- [Cado Security Commando Cat 2024](https://www.cadosecurity.com/blog/the-nine-lives-of-commando-cat-analysing-a-novel-malware-campaign-targeting-docker)
- [Atomic Red Team - T1564.013](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1564.013)
- [MITRE ATT&CK - T1564.013](https://attack.mitre.org/techniques/T1564/013)
