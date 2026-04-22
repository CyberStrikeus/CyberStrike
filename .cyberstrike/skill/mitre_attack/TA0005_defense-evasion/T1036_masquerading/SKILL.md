---
name: "T1036_masquerading"
description: "Adversaries may attempt to manipulate features of their artifacts to make them appear legitimate or benign to users and/or security tools."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1036
  - defense-evasion
  - containers
  - esxi
  - linux
  - macos
  - windows
technique_id: "T1036"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Containers
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1036"
tech_stack:
  - containers
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
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
  - T1036.012
prerequisites: []
severity_boost:
  T1036.001: "Chain with T1036.001 for deeper attack path"
  T1036.002: "Chain with T1036.002 for deeper attack path"
  T1036.003: "Chain with T1036.003 for deeper attack path"
---

# T1036 Masquerading

## High-Level Description

Adversaries may attempt to manipulate features of their artifacts to make them appear legitimate or benign to users and/or security tools. Masquerading occurs when the name or location of an object, legitimate or malicious, is manipulated or abused for the sake of evading defenses and observation. This may include manipulating file metadata, tricking users into misidentifying the file type, and giving legitimate task or service names.

Renaming abusable system utilities to evade security monitoring is also a form of Masquerading.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Containers, ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Masquerading technique is applicable to target environment
- [ ] Check Containers systems for indicators of Masquerading
- [ ] Check ESXi systems for indicators of Masquerading
- [ ] Check Linux systems for indicators of Masquerading
- [ ] Verify mitigations are bypassed or absent (8 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: System File Copied to Unusual Location

It may be suspicious seeing a file copy of an EXE in System32 or SysWOW64 to a non-system directory or executing from a non-system directory.

**Supported Platforms:** windows

```powershell
copy-item "$env:windir\System32\cmd.exe" -destination "$env:allusersprofile\cmd.exe"
start-process "$env:allusersprofile\cmd.exe"
sleep -s 5
stop-process -name "cmd" | out-null
```

### Atomic Test 2: Malware Masquerading and Execution from Zip File

When the file is unzipped and the README.cmd file opened, it executes and changes the .pdf to .dll and executes the dll. This is a BazaLoader technique [as reported here](https://twitter.com/ffforward/status/1481672378639912960)

**Supported Platforms:** windows

```powershell
Expand-Archive -Path "PathToAtomicsFolder\..\ExternalPayloads\T1036.zip" -DestinationPath "$env:userprofile\Downloads\T1036" -Force
cd "$env:userprofile\Downloads\T1036"
cmd /c "$env:userprofile\Downloads\T1036\README.cmd" >$null 2>$null
```

**Dependencies:**

- Zip file must be present.

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Masquerading by examining the target platforms (Containers, ESXi, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1036 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1047 Audit

Audit user accounts to ensure that each one has a defined purpose.

### M1018 User Account Management

Consider defining and enforcing a naming convention for user accounts to more easily spot generic account names that do not fit the typical schema.

### M1017 User Training

Train users not to open email attachments or click unknown links (URLs). Such training fosters more secure habits within your organization and will limit many of the risks.

### M1045 Code Signing

Require signed binaries.

### M1040 Behavior Prevention on Endpoint

Implement security controls on the endpoint, such as a Host Intrusion Prevention System (HIPS), to identify and prevent execution of potentially malicious files (such as those with mismatching file signatures).

### M1022 Restrict File and Directory Permissions

Use file system access controls to protect folders such as C:\\Windows\\System32.

### M1049 Antivirus/Antimalware

Anti-virus can be used to automatically quarantine suspicious files.

### M1038 Execution Prevention

Use tools that restrict program execution via application control by attributes other than file name for common operating system utilities that are needed.

## Detection

### Behavioral Detection of Masquerading Across Platforms via Metadata and Execution Discrepancy

## Risk Assessment

| Finding                           | Severity | Impact          |
| --------------------------------- | -------- | --------------- |
| Masquerading technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Twitter ItsReallyNick Masquerading Update](https://x.com/ItsReallyNick/status/1055321652777619457)
- [Elastic Masquerade Ball](https://www.elastic.co/blog/how-hunt-masquerade-ball)
- [LOLBAS Main Site](https://lolbas-project.github.io/)
- [Atomic Red Team - T1036](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1036)
- [MITRE ATT&CK - T1036](https://attack.mitre.org/techniques/T1036)
