---
name: "T1574.011_services-registry-permissions-weakness"
description: "Adversaries may execute their own malicious payloads by hijacking the Registry entries used by services."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1574.011
  - persistence
  - privilege-escalation
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1574.011"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1574/011"
tech_stack:
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1574
  - T1574.001
  - T1574.004
  - T1574.005
  - T1574.006
  - T1574.007
  - T1574.008
  - T1574.009
  - T1574.010
  - T1574.012
  - T1574.013
  - T1574.014
prerequisites:
  - T1574
severity_boost:
  T1574: "Chain with T1574 for deeper attack path"
  T1574.001: "Chain with T1574.001 for deeper attack path"
  T1574.004: "Chain with T1574.004 for deeper attack path"
---

# T1574.011 Services Registry Permissions Weakness

> **Sub-technique of:** T1574

## High-Level Description

Adversaries may execute their own malicious payloads by hijacking the Registry entries used by services. Flaws in the permissions for Registry keys related to services can allow adversaries to redirect the originally specified executable to one they control, launching their own code when a service starts. Windows stores local service configuration information in the Registry under <code>HKLM\SYSTEM\CurrentControlSet\Services</code>. The information stored under a service's Registry keys can be manipulated to modify a service's execution parameters through tools such as the service controller, sc.exe, PowerShell, or Reg. Access to Registry keys is controlled through access control lists and user permissions. 

If the permissions for users and groups are not properly set and allow access to the Registry keys for a service, adversaries may change the service's binPath/ImagePath to point to a different executable under their control. When the service starts or is restarted, the adversary-controlled program will execute, allowing the adversary to establish persistence and/or privilege escalation to the account context the service is set to execute under (local/domain account, SYSTEM, LocalService, or NetworkService).

Adversaries may also alter other Registry keys in the service’s Registry tree. For example, the <code>FailureCommand</code> key may be changed so that the service is executed in an elevated context anytime the service fails or is intentionally corrupted.

The <code>Performance</code> key contains the name of a driver service's performance DLL and the names of several exported functions in the DLL. If the <code>Performance</code> key is not already present and if an adversary-controlled user has the <code>Create Subkey</code> permission, adversaries may create the <code>Performance</code> key in the service’s Registry tree to point to a malicious DLL.

Adversaries may also add the <code>Parameters</code> key, which can reference malicious drivers file paths. This technique has been identified to be a method of abuse by configuring DLL file paths within the <code>Parameters</code> key of a given services registry configuration. By placing and configuring the <code>Parameters</code> key to reference a malicious DLL, adversaries can ensure that their code is loaded persistently whenever the associated service or library is invoked.

For example, the registry path <code>HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\WinSock2\Parameters</code> contains the <code>AutodiaDLL</code> value, which specifies the DLL to be loaded for autodial funcitionality. An adversary could set the <code>AutodiaDLL</code> to point to a hijacked or malicious DLL:

<code>"AutodialDLL"="c:\temp\foo.dll"</code>

This ensures persistence, as it causes the DLL (in this case, foo.dll) to be loaded each time the Winsock 2 library is invoked.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)
- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Services Registry Permissions Weakness technique is applicable to target environment
- [ ] Check Windows systems for indicators of Services Registry Permissions Weakness
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Service Registry Permissions Weakness

Service registry permissions weakness check and then which can lead to privilege escalation with ImagePath. eg.
reg add "HKLM\SYSTEM\CurrentControlSet\Services\#{weak_service_name}" /f /v ImagePath /d "C:\temp\AtomicRedteam.exe"

**Supported Platforms:** windows

```powershell
get-acl REGISTRY::HKLM\SYSTEM\CurrentControlSet\Services\* |FL
get-acl REGISTRY::HKLM\SYSTEM\CurrentControlSet\Services\#{weak_service_name} |FL
```

### Atomic Test 2: Service ImagePath Change with reg.exe

Change Service registry ImagePath of a bengin service to a malicious file

**Supported Platforms:** windows

```cmd
reg.exe add "HKLM\SYSTEM\CurrentControlSet\Services\#{weak_service_name}" /f /v ImagePath /d "#{malicious_service_path}"
```

**Dependencies:**
- The service must exist (#{weak_service_name})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Services Registry Permissions Weakness by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1574.011 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1024 Restrict Registry Permissions
Ensure proper permissions are set for Registry hives to prevent users from modifying keys for system components that may lead to privilege escalation.


## Detection

### Detection Strategy for Hijack Execution Flow through Service Registry Premission Weakness.


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Services Registry Permissions Weakness technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Tweet Registry Perms Weakness](https://x.com/r0wdy_/status/936365549553991680)
- [insecure_reg_perms](https://itm4n.github.io/windows-registry-rpceptmapper-eop/)
- [hexacorn](https://www.hexacorn.com/blog/2015/01/13/beyond-good-ol-run-key-part-24/)
- [Kansa Service related collectors](https://trustedsignal.blogspot.com/2014/05/kansa-service-related-collectors-and.html)
- [malware_hides_service](https://www.bleepingcomputer.com/tutorials/how-malware-hides-as-a-service/)
- [Autoruns for Windows](https://docs.microsoft.com/en-us/sysinternals/downloads/autoruns)
- [MDSec](https://www.mdsec.co.uk/2022/10/autodialdlling-your-way/)
- [Registry Key Security](https://docs.microsoft.com/en-us/windows/win32/sysinfo/registry-key-security-and-access-rights?redirectedfrom=MSDN)
- [microsoft_services_registry_tree](https://docs.microsoft.com/en-us/windows-hardware/drivers/install/hklm-system-currentcontrolset-services-registry-tree)
- [gendigital](https://www.gendigital.com/blog/insights/research/operation-dragon-castling-apt-group-targeting-betting-companies)
- [Atomic Red Team - T1574.011](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1574.011)
- [MITRE ATT&CK - T1574.011](https://attack.mitre.org/techniques/T1574/011)
