---
name: "T1652_device-driver-discovery"
description: "Adversaries may attempt to enumerate local device drivers on a victim host."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1652
  - discovery
  - linux
  - macos
  - windows
technique_id: "T1652"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1652"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1652 Device Driver Discovery

## High-Level Description

Adversaries may attempt to enumerate local device drivers on a victim host. Information about device drivers may highlight various insights that shape follow-on behaviors, such as the function/purpose of the host, present security tools (i.e. Security Software Discovery) or other defenses (e.g., Virtualization/Sandbox Evasion), as well as potential exploitable vulnerabilities (e.g., Exploitation for Privilege Escalation).

Many OS utilities may provide information about local device drivers, such as `driverquery.exe` and the `EnumDeviceDrivers()` API function on Windows. Information about device drivers (as well as associated services, i.e., System Service Discovery) may also be available in the Registry.

On Linux/macOS, device drivers (in the form of kernel modules) may be visible within `/dev` or using utilities such as `lsmod` and `modinfo`.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Device Driver Discovery technique is applicable to target environment
- [ ] Check Linux systems for indicators of Device Driver Discovery
- [ ] Check macOS systems for indicators of Device Driver Discovery
- [ ] Check Windows systems for indicators of Device Driver Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Device Driver Discovery

Displays a list of installed device drivers on the local computer and their properties. Threat actors use this command to enumerate the existing drivers on the computer.
Parameters:
/v /fo list - Displays verbose output in a list format - the /v parameter is not valid for signed drivers
/si /fo list - Provides information about signed drivers and outputs it in a list format

**Supported Platforms:** windows

```powershell
driverquery /v /fo list
driverquery /si /fo list
```

### Atomic Test 2: Device Driver Discovery (Linux)

Displays a list of loaded kernel modules on a Linux system, which is used to enumerate drivers.

**Supported Platforms:** linux

```bash
lsmod
```

### Atomic Test 3: Enumerate Kernel Driver Files (Linux)

Finds and lists all kernel driver files on a Linux system in order to provide a broader view of available drivers, not just loaded ones.

**Supported Platforms:** linux

```bash
find /lib/modules/$(uname -r)/kernel/drivers -name "*.ko*"
```

### Atomic Test 4: List loaded kernel extensions (macOS)

Displays a list of loaded kernel extensions (kexts) on a macOS system.

**Supported Platforms:** macos

```bash
kextstat
```

### Atomic Test 5: Find Kernel Extensions (macOS)

Searches for kernel extension (kext) files on a macOS system.

**Supported Platforms:** macos

```bash
kextfind
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Device Driver Discovery by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1652 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Device Driver Discovery

## Risk Assessment

| Finding                                      | Severity | Impact    |
| -------------------------------------------- | -------- | --------- |
| Device Driver Discovery technique applicable | High     | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [lsmod man](https://man7.org/linux/man-pages/man8/lsmod.8.html)
- [Microsoft Registry Drivers](https://learn.microsoft.com/windows-hardware/drivers/install/overview-of-registry-trees-and-keys)
- [Microsoft EnumDeviceDrivers](https://learn.microsoft.com/windows/win32/api/psapi/nf-psapi-enumdevicedrivers)
- [Microsoft Driverquery](https://learn.microsoft.com/windows-server/administration/windows-commands/driverquery)
- [Linux Kernel Programming](https://www.tldp.org/LDP/lkmpg/2.4/lkmpg.pdf)
- [modinfo man](https://linux.die.net/man/8/modinfo)
- [Atomic Red Team - T1652](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1652)
- [MITRE ATT&CK - T1652](https://attack.mitre.org/techniques/T1652)
