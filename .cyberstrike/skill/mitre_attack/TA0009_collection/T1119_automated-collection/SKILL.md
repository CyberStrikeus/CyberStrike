---
name: "T1119_automated-collection"
description: "Once established within a system or network, an adversary may use automated techniques for collecting internal data."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1119
  - collection
  - iaas
  - linux
  - macos
  - office-suite
  - saas
  - windows
technique_id: "T1119"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - IaaS
  - Linux
  - macOS
  - Office Suite
  - SaaS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1119"
tech_stack:
  - cloud
  - linux
  - macos
  - office
  - saas
  - windows
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1119 Automated Collection

## High-Level Description

Once established within a system or network, an adversary may use automated techniques for collecting internal data. Methods for performing this technique could include use of a Command and Scripting Interpreter to search for and copy information fitting set criteria such as file type, location, or name at specific time intervals.

In cloud-based environments, adversaries may also use cloud APIs, data pipelines, command line interfaces, or extract, transform, and load (ETL) services to automatically collect data.

This functionality could also be built into remote access tools.

This technique may incorporate use of other techniques such as File and Directory Discovery and Lateral Tool Transfer to identify and move files, as well as Cloud Service Dashboard and Cloud Storage Object Discovery to identify resources in cloud environments.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** IaaS, Linux, macOS, Office Suite, SaaS, Windows

## What to Check

- [ ] Identify if Automated Collection technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Automated Collection
- [ ] Check Linux systems for indicators of Automated Collection
- [ ] Check macOS systems for indicators of Automated Collection
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Automated Collection Command Prompt

Automated Collection. Upon execution, check the users temp directory (%temp%) for the folder T1119_command_prompt_collection
to see what was collected.

**Supported Platforms:** windows

```cmd
mkdir %temp%\T1119_command_prompt_collection >nul 2>&1
dir c: /b /s .docx | findstr /e .docx
for /R c:\ %f in (*.docx) do copy /Y %f %temp%\T1119_command_prompt_collection
```

### Atomic Test 2: Automated Collection PowerShell

Automated Collection. Upon execution, check the users temp directory (%temp%) for the folder T1119_powershell_collection
to see what was collected.

**Supported Platforms:** windows

```powershell
New-Item -Path $env:TEMP\T1119_powershell_collection -ItemType Directory -Force | Out-Null
Get-ChildItem -Recurse -Include *.doc | % {Copy-Item $_.FullName -destination $env:TEMP\T1119_powershell_collection}
```

### Atomic Test 3: Recon information for export with PowerShell

collect information for exfiltration. Upon execution, check the users temp directory (%temp%) for files T1119\_\*.txt
to see what was collected.

**Supported Platforms:** windows

```powershell
Get-Service > $env:TEMP\T1119_1.txt
Get-ChildItem Env: > $env:TEMP\T1119_2.txt
Get-Process > $env:TEMP\T1119_3.txt
```

### Atomic Test 4: Recon information for export with Command Prompt

collect information for exfiltration. Upon execution, check the users temp directory (%temp%) for files T1119\_\*.txt
to see what was collected.

**Supported Platforms:** windows

```cmd
sc query type=service > %TEMP%\T1119_1.txt
doskey /history > %TEMP%\T1119_2.txt
wmic process list > %TEMP%\T1119_3.txt
tree C:\AtomicRedTeam\atomics > %TEMP%\T1119_4.txt
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Automated Collection by examining the target platforms (IaaS, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1119 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1029 Remote Data Storage

Encryption and off-system storage of sensitive information may be one way to mitigate collection of files, but may not stop an adversary from acquiring the information if an intrusion persists over a long period of time and the adversary is able to discover and access the data through other means.

### M1041 Encrypt Sensitive Information

Encryption and off-system storage of sensitive information may be one way to mitigate collection of files, but may not stop an adversary from acquiring the information if an intrusion persists over a long period of time and the adversary is able to discover and access the data through other means. Strong passwords should be used on certain encrypted documents that use them to prevent offline cracking through Brute Force techniques.

## Detection

### Automated File and API Collection Detection Across Platforms

## Risk Assessment

| Finding                                   | Severity | Impact     |
| ----------------------------------------- | -------- | ---------- |
| Automated Collection technique applicable | High     | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Mandiant UNC3944 SMS Phishing 2023](https://www.mandiant.com/resources/blog/unc3944-sms-phishing-sim-swapping-ransomware)
- [Atomic Red Team - T1119](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1119)
- [MITRE ATT&CK - T1119](https://attack.mitre.org/techniques/T1119)
