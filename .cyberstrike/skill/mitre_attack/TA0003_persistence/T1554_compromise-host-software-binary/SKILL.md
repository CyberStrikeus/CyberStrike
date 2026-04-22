---
name: "T1554_compromise-host-software-binary"
description: "Adversaries may modify host software binaries to establish persistent access to systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1554
  - persistence
  - linux
  - macos
  - windows
  - esxi
technique_id: "T1554"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Linux
  - macOS
  - Windows
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1554"
tech_stack:
  - linux
  - macos
  - windows
  - esxi
cwe_ids:
  - CWE-276
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1554 Compromise Host Software Binary

## High-Level Description

Adversaries may modify host software binaries to establish persistent access to systems. Software binaries/executables provide a wide range of system commands or services, programs, and libraries. Common software binaries are SSH clients, FTP clients, email clients, web browsers, and many other user or server applications.

Adversaries may establish persistence though modifications to host software binaries. For example, an adversary may replace or otherwise infect a legitimate application binary (or support files) with a backdoor. Since these binaries may be routinely executed by applications or the user, the adversary can leverage this for persistent access to the host. An adversary may also modify a software binary such as an SSH client in order to persistently collect credentials during logins (i.e., Modify Authentication Process).

An adversary may also modify an existing binary by patching in malicious functionality (e.g., IAT Hooking/Entry point patching) prior to the binary’s legitimate execution. For example, an adversary may modify the entry point of a binary to point to malicious code patched in by the adversary before resuming normal execution flow.

After modifying a binary, an adversary may attempt to Impair Defenses by preventing it from updating (e.g., via the `yum-versionlock` command or `versionlock.list` file in Linux systems that use the yum package manager).

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Linux, macOS, Windows, ESXi

## What to Check

- [ ] Identify if Compromise Host Software Binary technique is applicable to target environment
- [ ] Check Linux systems for indicators of Compromise Host Software Binary
- [ ] Check macOS systems for indicators of Compromise Host Software Binary
- [ ] Check Windows systems for indicators of Compromise Host Software Binary
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Compromise Host Software Binary by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1554 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1045 Code Signing
Ensure all application component binaries are signed by the correct application developers.


## Detection

### Detect Compromise of Host Software Binaries


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Compromise Host Software Binary technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Google Cloud Mandiant UNC3886 2024](https://cloud.google.com/blog/topics/threat-intelligence/uncovering-unc3886-espionage-operations)
- [Unit42 Banking Trojans Hooking 2022](https://unit42.paloaltonetworks.com/banking-trojan-techniques/#post-125550-_rm3d6xxbk52n)
- [ESET FontOnLake Analysis 2021](https://web-assets.esetstatic.com/wls/2021/10/eset_fontonlake.pdf)
- [Atomic Red Team - T1554](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1554)
- [MITRE ATT&CK - T1554](https://attack.mitre.org/techniques/T1554)
