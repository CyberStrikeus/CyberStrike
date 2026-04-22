---
name: "T1547_boot-or-logon-autostart-execution"
description: "Adversaries may configure system settings to automatically execute a program during system boot or logon to maintain persistence or gain higher-level privileges on compromised systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1547
  - persistence
  - privilege-escalation
  - linux
  - macos
  - windows
  - network-devices
technique_id: "T1547"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Linux
  - macOS
  - Windows
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1547"
tech_stack:
  - linux
  - macos
  - windows
  - network devices
cwe_ids:
  - CWE-276
chains_with:
  - T1547.001
  - T1547.002
  - T1547.003
  - T1547.004
  - T1547.005
  - T1547.006
  - T1547.007
  - T1547.008
  - T1547.009
  - T1547.010
  - T1547.012
  - T1547.013
  - T1547.014
  - T1547.015
prerequisites: []
severity_boost:
  T1547.001: "Chain with T1547.001 for deeper attack path"
  T1547.002: "Chain with T1547.002 for deeper attack path"
  T1547.003: "Chain with T1547.003 for deeper attack path"
---

# T1547 Boot or Logon Autostart Execution

## High-Level Description

Adversaries may configure system settings to automatically execute a program during system boot or logon to maintain persistence or gain higher-level privileges on compromised systems. Operating systems may have mechanisms for automatically running a program on system boot or account logon. These mechanisms may include automatically executing programs that are placed in specially designated directories or are referenced by repositories that store configuration information, such as the Windows Registry. An adversary may achieve the same goal by modifying or extending features of the kernel.

Since some boot or logon autostart programs run with higher privileges, an adversary may leverage these to elevate privileges.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Linux, macOS, Windows, Network Devices

## What to Check

- [ ] Identify if Boot or Logon Autostart Execution technique is applicable to target environment
- [ ] Check Linux systems for indicators of Boot or Logon Autostart Execution
- [ ] Check macOS systems for indicators of Boot or Logon Autostart Execution
- [ ] Check Windows systems for indicators of Boot or Logon Autostart Execution
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Add a driver

Install a driver via pnputil.exe lolbin

**Supported Platforms:** windows

```cmd
pnputil.exe /add-driver "#{driver_inf}"
```

### Atomic Test 2: Driver Installation Using pnputil.exe

pnputil.exe is a native command-line utility in Windows to install drivers, this can be abused by to install malicious drivers. Ref: https://lolbas-project.github.io/lolbas/Binaries/Pnputil/

**Supported Platforms:** windows

```powershell
pnputil.exe -i -a #{driver_path}
```

### Atomic Test 3: Leverage Virtual Channels to execute custom DLL during successful RDP session

Virtual Channels can be leveraged to alter RDP behavior using dedicated Addins.The mechanism is implemented using DLLs which can be executed during RDP session automatically.
The DLLs are loaded in the host system only after successful connection is established with the remote system.
Once the test is run, amsi.dll will be loaded on the host system during successful RDP session.
Blog :https://learn.microsoft.com/en-us/windows/win32/termserv/terminal-services-virtual-channels?redirectedfrom=MSDN

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
reg add "HKEY_CURRENT_USER\Software\Microsoft\Terminal Server Client\Default\Addins\#{Subkey_Added}" /v Name /t REG_SZ /d "#{dll_inf}" /f
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Boot or Logon Autostart Execution by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1547 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Boot or Logon Autostart Execution Detection Strategy

## Risk Assessment

| Finding                                                | Severity | Impact      |
| ------------------------------------------------------ | -------- | ----------- |
| Boot or Logon Autostart Execution technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Cylance Reg Persistence Sept 2013](https://web.archive.org/web/20160214140250/http://blog.cylance.com/windows-registry-persistence-part-2-the-run-keys-and-search-order)
- [MSDN Authentication Packages](https://msdn.microsoft.com/library/windows/desktop/aa374733.aspx)
- [Microsoft Run Key](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys)
- [Microsoft TimeProvider](https://msdn.microsoft.com/library/windows/desktop/ms725475.aspx)
- [Linux Kernel Programming](https://www.tldp.org/LDP/lkmpg/2.4/lkmpg.pdf)
- [TechNet Autoruns](https://technet.microsoft.com/en-us/sysinternals/bb963902)
- [Atomic Red Team - T1547](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1547)
- [MITRE ATT&CK - T1547](https://attack.mitre.org/techniques/T1547)
