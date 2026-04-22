---
name: "T1027.002_software-packing"
description: "Adversaries may perform software packing or virtual machine software protection to conceal their code."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1027.002
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1027.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1027/002"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1027
  - T1027.001
  - T1027.003
  - T1027.004
  - T1027.005
  - T1027.006
  - T1027.007
  - T1027.008
  - T1027.009
  - T1027.010
  - T1027.011
  - T1027.012
  - T1027.013
  - T1027.014
  - T1027.015
  - T1027.016
  - T1027.017
prerequisites:
  - T1027
severity_boost:
  T1027: "Chain with T1027 for deeper attack path"
  T1027.001: "Chain with T1027.001 for deeper attack path"
  T1027.003: "Chain with T1027.003 for deeper attack path"
---

# T1027.002 Software Packing

> **Sub-technique of:** T1027

## High-Level Description

Adversaries may perform software packing or virtual machine software protection to conceal their code. Software packing is a method of compressing or encrypting an executable. Packing an executable changes the file signature in an attempt to avoid signature-based detection. Most decompression techniques decompress the executable code in memory. Virtual machine software protection translates an executable's original code into a special format that only a special virtual machine can run. A virtual machine is then called to run this code.

Utilities used to perform software packing are called packers. Example packers are MPRESS and UPX. A more comprehensive list of known packers is available, but adversaries may create their own packing techniques that do not leave the same artifacts as well-known packers to evade defenses.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Software Packing technique is applicable to target environment
- [ ] Check Linux systems for indicators of Software Packing
- [ ] Check macOS systems for indicators of Software Packing
- [ ] Check Windows systems for indicators of Software Packing
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Binary simply packed by UPX (linux)

Copies and then runs a simple binary (just outputting "the cake is a lie"), that was packed by UPX.
No other protection/compression were applied.

**Supported Platforms:** linux

```bash
cp #{bin_path} /tmp/packed_bin && /tmp/packed_bin
```

### Atomic Test 2: Binary packed by UPX, with modified headers (linux)

Copies and then runs a simple binary (just outputting "the cake is a lie"), that was packed by UPX.

The UPX magic number (`0x55505821`, "`UPX!`") was changed to (`0x4c4f5452`, "`LOTR`"). This prevents the binary from being detected
by some methods, and especially UPX is not able to uncompress it any more.

**Supported Platforms:** linux

```bash
cp #{bin_path} /tmp/packed_bin && /tmp/packed_bin
```

### Atomic Test 3: Binary simply packed by UPX

Copies and then runs a simple binary (just outputting "the cake is a lie"), that was packed by UPX.
No other protection/compression were applied.

**Supported Platforms:** macos

```bash
cp #{bin_path} /tmp/packed_bin && /tmp/packed_bin
```

### Atomic Test 4: Binary packed by UPX, with modified headers

Copies and then runs a simple binary (just outputting "the cake is a lie"), that was packed by UPX.

The UPX magic number (`0x55505821`, "`UPX!`") was changed to (`0x4c4f5452`, "`LOTR`"). This prevents the binary from being detected
by some methods, and especially UPX is not able to uncompress it any more.

**Supported Platforms:** macos

```bash
cp #{bin_path} /tmp/packed_bin && /tmp/packed_bin
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Software Packing by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1027.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1049 Antivirus/Antimalware

Employ heuristic-based malware detection. Ensure updated virus definitions and create custom signatures for observed malware.

## Detection

### Obfuscated Binary Unpacking Detection via Behavioral Patterns

## Risk Assessment

| Finding                               | Severity | Impact          |
| ------------------------------------- | -------- | --------------- |
| Software Packing technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Awesome Executable Packing](https://github.com/dhondta/awesome-executable-packing)
- [ESET FinFisher Jan 2018](https://www.welivesecurity.com/wp-content/uploads/2018/01/WP-FinFisher.pdf)
- [Atomic Red Team - T1027.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1027.002)
- [MITRE ATT&CK - T1027.002](https://attack.mitre.org/techniques/T1027/002)
