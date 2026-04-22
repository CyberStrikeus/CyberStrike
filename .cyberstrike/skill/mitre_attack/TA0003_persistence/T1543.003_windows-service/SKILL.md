---
name: "T1543.003_windows-service"
description: "Adversaries may create or modify Windows services to repeatedly execute malicious payloads as part of persistence."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1543.003
  - persistence
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1543.003"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1543/003"
tech_stack:
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1543
  - T1543.001
  - T1543.002
  - T1543.004
  - T1543.005
prerequisites:
  - T1543
severity_boost:
  T1543: "Chain with T1543 for deeper attack path"
  T1543.001: "Chain with T1543.001 for deeper attack path"
  T1543.002: "Chain with T1543.002 for deeper attack path"
---

# T1543.003 Windows Service

> **Sub-technique of:** T1543

## High-Level Description

Adversaries may create or modify Windows services to repeatedly execute malicious payloads as part of persistence. When Windows boots up, it starts programs or applications called services that perform background system functions. Windows service configuration information, including the file path to the service's executable or recovery programs/commands, is stored in the Windows Registry.

Adversaries may install a new service or modify an existing service to execute at startup in order to persist on a system. Service configurations can be set or modified using system utilities (such as sc.exe), by directly modifying the Registry, or by interacting directly with the Windows API. 

Adversaries may also use services to install and execute malicious drivers. For example, after dropping a driver file (ex: `.sys`) to disk, the payload can be loaded and registered via Native API functions such as `CreateServiceW()` (or manually via functions such as `ZwLoadDriver()` and `ZwSetValueKey()`), by creating the required service Registry values (i.e. Modify Registry), or by using command-line utilities such as `PnPUtil.exe`. Adversaries may leverage these drivers as Rootkits to hide the presence of malicious activity on a system. Adversaries may also load a signed yet vulnerable driver onto a compromised machine (known as "Bring Your Own Vulnerable Driver" (BYOVD)) as part of Exploitation for Privilege Escalation.

Services may be created with administrator privileges but are executed under SYSTEM privileges, so an adversary may also use a service to escalate privileges. Adversaries may also directly start services through Service Execution.

To make detection analysis more challenging, malicious services may also incorporate Masquerade Task or Service (ex: using a service and/or payload name related to a legitimate OS or benign software component). Adversaries may also create ‘hidden’ services (i.e., Hide Artifacts), for example by using the `sc sdset` command to set service permissions via the Service Descriptor Definition Language (SDDL). This may hide a Windows service from the view of standard service enumeration methods such as `Get-Service`, `sc query`, and `services.exe`.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Windows Service technique is applicable to target environment
- [ ] Check Windows systems for indicators of Windows Service
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Modify Fax service to run PowerShell

This test will temporarily modify the service Fax by changing the binPath to PowerShell
and will then revert the binPath change, restoring Fax to its original state.
Upon successful execution, cmd will modify the binpath for `Fax` to spawn powershell. Powershell will then spawn.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
sc config #{service_name} binPath= "C:\windows\system32\WindowsPowerShell\v1.0\powershell.exe -noexit -c \"write-host 'T1543.003 Test'\""
sc start #{service_name}
```

### Atomic Test 2: Service Installation CMD

Download an executable from github and start it as a service.
Upon successful execution, powershell will download `AtomicService.exe` from github. cmd.exe will spawn sc.exe which will create and start the service. Results will output via stdout.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
sc.exe create #{service_name} binPath= "#{binary_path}" start=#{startup_type}  type=#{service_type}
sc.exe start #{service_name}
```

**Dependencies:**
- Service binary must exist on disk at specified location (#{binary_path})

### Atomic Test 3: Service Installation PowerShell

Installs A Local Service via PowerShell.
Upon successful execution, powershell will download `AtomicService.exe` from github. Powershell will then use `New-Service` and `Start-Service` to start service. Results will be displayed.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
New-Service -Name "#{service_name}" -BinaryPathName "#{binary_path}"
Start-Service -Name "#{service_name}"
```

**Dependencies:**
- Service binary must exist on disk at specified location (#{binary_path})

### Atomic Test 4: TinyTurla backdoor service w64time

It's running Dll as service to emulate the TinyTurla backdoor

[Related Talos Blog](https://blog.talosintelligence.com/2021/09/tinyturla.html)

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
copy "#{dllfilename}" %systemroot%\system32\
sc create W64Time binPath= "c:\Windows\System32\svchost.exe -k TimeService" type= share start=auto
sc config W64Time DisplayName= "Windows 64 Time"
sc description W64Time "Maintain date and time synch on all clients and services in the network"
reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Svchost" /v TimeService /t REG_MULTI_SZ /d "W64Time" /f
reg add "HKLM\SYSTEM\CurrentControlSet\Services\W64Time\Parameters" /v ServiceDll /t REG_EXPAND_SZ /d "%systemroot%\system32\w64time.dll" /f
sc start W64Time
```

### Atomic Test 5: Remote Service Installation CMD

Download an executable from github and start it as a service on a remote endpoint
Upon successful execution, powershell will download `AtomicService.exe` from github. cmd.exe will spawn sc.exe which will create and start the service. Results will output via stdout.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
sc.exe \\#{remote_host} create #{service_name} binPath= "#{binary_path}" start=#{startup_type} type=#{service_type}
sc.exe \\#{remote_host} start #{service_name}
```

**Dependencies:**
- Service binary must exist on disk at specified location (#{binary_path})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Windows Service by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1543.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint
On Windows 10, enable Attack Surface Reduction (ASR) rules to prevent an application from writing a signed vulnerable driver to the system. On Windows 10 and 11, enable Microsoft Vulnerable Driver Blocklist to assist in hardening against third party-developed service drivers.

### M1028 Operating System Configuration
Ensure that Driver Signature Enforcement is enabled to restrict unsigned drivers from being installed.

### M1047 Audit
Use auditing tools capable of detecting privilege and service abuse opportunities on systems within an enterprise and correct them.

### M1045 Code Signing
Enforce registration and execution of only legitimately signed service drivers where possible.

### M1018 User Account Management
Limit privileges of user accounts and groups so that only authorized administrators can interact with service changes and service configurations.


## Detection

### Detection of Windows Service Creation or Modification


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Windows Service technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Microsoft Windows Event Forwarding FEB 2018](https://docs.microsoft.com/windows/security/threat-protection/use-windows-event-forwarding-to-assist-in-intrusion-detection)
- [ESET InvisiMole June 2020](https://www.welivesecurity.com/wp-content/uploads/2020/06/ESET_InvisiMole.pdf)
- [SANS 1](https://www.sans.org/blog/red-team-tactics-hiding-windows-services/)
- [SANS 2](https://www.sans.org/blog/defense-spotlight-finding-hidden-windows-services/)
- [TechNet Services](https://technet.microsoft.com/en-us/library/cc772408.aspx)
- [Microsoft 4697 APR 2017](https://docs.microsoft.com/windows/security/threat-protection/auditing/event-4697)
- [Symantec W.32 Stuxnet Dossier](https://www.wired.com/images_blogs/threatlevel/2010/11/w32_stuxnet_dossier.pdf)
- [Unit42 AcidBox June 2020](https://unit42.paloaltonetworks.com/acidbox-rare-malware/)
- [TechNet Autoruns](https://technet.microsoft.com/en-us/sysinternals/bb963902)
- [Crowdstrike DriveSlayer February 2022](https://www.crowdstrike.com/blog/how-crowdstrike-falcon-protects-against-wiper-malware-used-in-ukraine-attacks/)
- [Atomic Red Team - T1543.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1543.003)
- [MITRE ATT&CK - T1543.003](https://attack.mitre.org/techniques/T1543/003)
