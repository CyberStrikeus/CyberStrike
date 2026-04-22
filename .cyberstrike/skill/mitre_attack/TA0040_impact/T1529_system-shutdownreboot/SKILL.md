---
name: "T1529_system-shutdownreboot"
description: "Adversaries may shutdown/reboot systems to interrupt access to, or aid in the destruction of, those systems."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1529
  - impact
  - esxi
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1529"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1529"
tech_stack:
  - esxi
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-400
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1529 System Shutdown/Reboot

## High-Level Description

Adversaries may shutdown/reboot systems to interrupt access to, or aid in the destruction of, those systems. Operating systems may contain commands to initiate a shutdown/reboot of a machine or network device. In some cases, these commands may also be used to initiate a shutdown/reboot of a remote computer or network device via Network Device CLI (e.g. <code>reload</code>). They may also include shutdown/reboot of a virtual machine via hypervisor / cloud consoles or command line tools.

Shutting down or rebooting systems may disrupt access to computer resources for legitimate users while also impeding incident response/recovery.

Adversaries may also use Windows API functions, such as `InitializeSystemShutdownExW` or `ExitWindowsEx`, to force a system to shut down or reboot. Alternatively, the `NtRaiseHardError`or `ZwRaiseHardError` Windows API functions with the `ResponseOption` parameter set to `OptionShutdownSystem` may deliver a “blue screen of death” (BSOD) to a system. In order to leverage these API functions, an adversary may need to acquire `SeShutdownPrivilege` (e.g., via Access Token Manipulation).
 In some cases, the system may not be able to boot again. 

Adversaries may attempt to shutdown/reboot a system after impacting it in other ways, such as Disk Structure Wipe or Inhibit System Recovery, to hasten the intended effects on system availability.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if System Shutdown/Reboot technique is applicable to target environment
- [ ] Check ESXi systems for indicators of System Shutdown/Reboot
- [ ] Check Linux systems for indicators of System Shutdown/Reboot
- [ ] Check macOS systems for indicators of System Shutdown/Reboot
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Shutdown System - Windows

This test shuts down a Windows system.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
shutdown /s /t #{timeout}
```

### Atomic Test 2: Restart System - Windows

This test restarts a Windows system.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
shutdown /r /t #{timeout}
```

### Atomic Test 3: Restart System via `shutdown` - FreeBSD/macOS/Linux

This test restarts a FreeBSD/macOS/Linux system.

**Supported Platforms:** linux, macos
**Elevation Required:** Yes

```bash
shutdown -r #{timeout}
```

### Atomic Test 4: Shutdown System via `shutdown` - FreeBSD/macOS/Linux

This test shuts down a FreeBSD/macOS/Linux system using a halt.

**Supported Platforms:** linux, macos
**Elevation Required:** Yes

```bash
shutdown -h #{timeout}
```

### Atomic Test 5: Restart System via `reboot` - FreeBSD/macOS/Linux

This test restarts a FreeBSD/macOS/Linux system via `reboot`.

**Supported Platforms:** linux, macos
**Elevation Required:** Yes

```bash
reboot
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to System Shutdown/Reboot by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1529 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Multi-Platform Shutdown or Reboot Detection via Execution and Host Status Events


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| System Shutdown/Reboot technique applicable | High | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [Talos Nyetya June 2017](https://blog.talosintelligence.com/2017/06/worldwide-ransomware-variant.html)
- [alert_TA18_106A](https://www.cisa.gov/uscert/ncas/alerts/TA18-106A)
- [NotMe-BSOD](https://github.com/lzcapp/NotMe-BSOD)
- [Talos Olympic Destroyer 2018](https://blog.talosintelligence.com/2018/02/olympic-destroyer.html)
- [Microsoft Shutdown Oct 2017](https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/shutdown)
- [NtRaiseHardError](https://ntdoc.m417z.com/ntraiseharderror)
- [Unit42 Agrius 2023](https://unit42.paloaltonetworks.com/agonizing-serpens-targets-israeli-tech-higher-ed-sectors/)
- [SonicWall](https://www.sonicwall.com/blog/disarming-darkgate-a-deep-dive-into-thwarting-the-latest-darkgate-variant)
- [CrowdStrike Blog](https://www.crowdstrike.com/en-us/blog/how-crowdstrike-falcon-protects-against-wiper-malware-used-in-ukraine-attacks/)
- [Atomic Red Team - T1529](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1529)
- [MITRE ATT&CK - T1529](https://attack.mitre.org/techniques/T1529)
