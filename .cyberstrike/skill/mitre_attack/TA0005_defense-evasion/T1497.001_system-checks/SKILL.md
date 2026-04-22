---
name: "T1497.001_system-checks"
description: "Adversaries may employ various system checks to detect and avoid virtualization and analysis environments."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1497.001
  - defense-evasion
  - discovery
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1497.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - discovery
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1497/001"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1497
  - T1497.002
  - T1497.003
prerequisites:
  - T1497
severity_boost:
  T1497: "Chain with T1497 for deeper attack path"
  T1497.002: "Chain with T1497.002 for deeper attack path"
  T1497.003: "Chain with T1497.003 for deeper attack path"
---

# T1497.001 System Checks

> **Sub-technique of:** T1497

## High-Level Description

Adversaries may employ various system checks to detect and avoid virtualization and analysis environments. This may include changing behaviors based on the results of checks for the presence of artifacts indicative of a virtual machine environment (VME) or sandbox. If the adversary detects a VME, they may alter their malware to disengage from the victim or conceal the core functions of the implant. They may also search for VME artifacts before dropping secondary or additional payloads. Adversaries may use the information learned from Virtualization/Sandbox Evasion during automated discovery to shape follow-on behaviors.

Specific checks will vary based on the target and/or adversary, but may involve behaviors such as Windows Management Instrumentation, PowerShell, System Information Discovery, and Query Registry to obtain system information and search for VME artifacts. Adversaries may search for VME artifacts in memory, processes, file system, hardware, and/or the Registry. Adversaries may use scripting to automate these checks into one script and then have the program exit if it determines the system to be a virtual environment.

Checks could include generic system properties such as host/domain name and samples of network traffic. Adversaries may also check the network adapters addresses, CPU core count, and available memory/drive size. Once executed, malware may also use File and Directory Discovery to check if it was saved in a folder or file with unexpected or even analysis-related naming artifacts such as `malware`, `sample`, or `hash`.

Other common checks may enumerate services running that are unique to these applications, installed programs on the system, manufacturer/product fields for strings relating to virtual machine applications, and VME-specific hardware/processor instructions. In applications like VMWare, adversaries can also use a special I/O port to send commands and receive output.

Hardware checks, such as the presence of the fan, temperature, and audio devices, could also be used to gather evidence that can be indicative a virtual environment. Adversaries may also query for specific readings from these devices.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Discovery (TA0007)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if System Checks technique is applicable to target environment
- [ ] Check Linux systems for indicators of System Checks
- [ ] Check macOS systems for indicators of System Checks
- [ ] Check Windows systems for indicators of System Checks
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Detect Virtualization Environment (Linux)

systemd-detect-virt detects execution in a virtualized environment.
At boot, dmesg stores a log if a hypervisor is detected.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
if (systemd-detect-virt) then echo "Virtualization Environment detected"; fi;
if (sudo dmidecode | egrep -i 'manufacturer|product|vendor' | grep -iE 'Oracle|VirtualBox|VMWare|Parallels') then echo "Virtualization Environment detected"; fi;
```

### Atomic Test 2: Detect Virtualization Environment (FreeBSD)

Detects execution in a virtualized environment.
At boot, dmesg stores a log if a hypervisor is detected.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
if [ "$(sysctl -n hw.hv_vendor)" != "" ]; then echo "Virtualization Environment detected"; fi
```

### Atomic Test 3: Detect Virtualization Environment (Windows)

Windows Management Instrumentation(WMI) objects contains system information which helps to detect virtualization. This command will specifically attempt to get the CurrentTemperature value from this object and will check to see if the attempt results in an error that contains the word supported. This is meant to find the result of Not supported, which is the result if run in a virtual machine

**Supported Platforms:** windows

```powershell
$error.clear()
Get-WmiObject -Query "SELECT * FROM MSAcpi_ThermalZoneTemperature" -ErrorAction SilentlyContinue
if($error) {echo "Virtualization Environment detected"}
```

### Atomic Test 4: Detect Virtualization Environment via ioreg

ioreg contains registry entries for all the device drivers in the system. If it's a virtual machine, one of the device manufacturer will be a Virtualization Software.

**Supported Platforms:** macos

```bash
if (ioreg -l | grep -e Manufacturer -e 'Vendor Name' | grep -iE 'Oracle|VirtualBox|VMWare|Parallels') then echo 'Virtualization Environment detected'; fi;
```

### Atomic Test 5: Detect Virtualization Environment via WMI Manufacturer/Model Listing (Windows)

Windows Management Instrumentation(WMI) objects contain system information which helps to detect virtualization. This test will get the model and manufacturer of the machine to determine if it is a virtual machine, such as through VMware or VirtualBox.

**Supported Platforms:** windows

```powershell
$Manufacturer = Get-WmiObject -Class Win32_ComputerSystem | select-object -expandproperty "Manufacturer"
$Model = Get-WmiObject -Class Win32_ComputerSystem | select-object -expandproperty "Model"
if((($Manufacturer.ToLower() -eq "microsoft corporation") -and ($Model.ToLower().contains("virtual"))) -or ($Manufacturer.ToLower().contains("vmware")) -or ($Model.ToLower() -eq "virtualbox")) {write-host "Virtualization environment detected!"} else {write-host "No virtualization environment detected!"}
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to System Checks by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1497.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Virtualization/Sandbox Evasion via System Checks across Windows, Linux, macOS

## Risk Assessment

| Finding                            | Severity | Impact          |
| ---------------------------------- | -------- | --------------- |
| System Checks technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Unit 42 OilRig Sept 2018](https://researchcenter.paloaltonetworks.com/2018/09/unit42-oilrig-targets-middle-eastern-government-adds-evasion-techniques-oopsie/)
- [McAfee Virtual Jan 2017](https://securingtomorrow.mcafee.com/other-blogs/mcafee-labs/stopping-malware-fake-virtual-machine/)
- [Deloitte Environment Awareness](https://drive.google.com/file/d/1t0jn3xr4ff2fR30oQAUn_RsWSnMpOAQc/edit)
- [Atomic Red Team - T1497.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1497.001)
- [MITRE ATT&CK - T1497.001](https://attack.mitre.org/techniques/T1497/001)
