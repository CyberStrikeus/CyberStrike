---
name: "T1218.007_msiexec"
description: "Adversaries may abuse msiexec.exe to proxy execution of malicious payloads."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1218.007
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1218.007"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1218/007"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1218
  - T1218.001
  - T1218.002
  - T1218.003
  - T1218.004
  - T1218.005
  - T1218.008
  - T1218.009
  - T1218.010
  - T1218.011
  - T1218.012
  - T1218.013
  - T1218.014
  - T1218.015
prerequisites:
  - T1218
severity_boost:
  T1218: "Chain with T1218 for deeper attack path"
  T1218.001: "Chain with T1218.001 for deeper attack path"
  T1218.002: "Chain with T1218.002 for deeper attack path"
---

# T1218.007 Msiexec

> **Sub-technique of:** T1218

## High-Level Description

Adversaries may abuse msiexec.exe to proxy execution of malicious payloads. Msiexec.exe is the command-line utility for the Windows Installer and is thus commonly associated with executing installation packages (.msi). The Msiexec.exe binary may also be digitally signed by Microsoft.

Adversaries may abuse msiexec.exe to launch local or network accessible MSI files. Msiexec.exe can also execute DLLs. Since it may be signed and native on Windows systems, msiexec.exe can be used to bypass application control solutions that do not account for its potential abuse. Msiexec.exe execution may also be elevated to SYSTEM privileges if the <code>AlwaysInstallElevated</code> policy is enabled.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Msiexec technique is applicable to target environment
- [ ] Check Windows systems for indicators of Msiexec
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Msiexec.exe - Execute Local MSI file with embedded JScript

Executes an MSI containing embedded JScript code using msiexec.exe

**Supported Platforms:** windows

```cmd
#{msi_exe} /q /#{action} "#{msi_payload}"
```

**Dependencies:**

- The MSI file must exist on disk at specified location (#{msi_payload})

### Atomic Test 2: Msiexec.exe - Execute Local MSI file with embedded VBScript

Executes an MSI containing embedded VBScript code using msiexec.exe

**Supported Platforms:** windows

```cmd
#{msi_exe} /q /#{action} "#{msi_payload}"
```

**Dependencies:**

- The MSI file must exist on disk at specified location (#{msi_payload})

### Atomic Test 3: Msiexec.exe - Execute Local MSI file with an embedded DLL

Executes an MSI containing an embedded DLL using msiexec.exe

**Supported Platforms:** windows

```cmd
#{msi_exe} /q /#{action} "#{msi_payload}"
```

**Dependencies:**

- The MSI file must exist on disk at specified location (#{msi_payload})

### Atomic Test 4: Msiexec.exe - Execute Local MSI file with an embedded EXE

Executes an MSI containing an embedded EXE using msiexec.exe

**Supported Platforms:** windows

```cmd
#{msi_exe} /q /#{action} "#{msi_payload}"
```

**Dependencies:**

- The MSI file must exist on disk at specified location (#{msi_payload})

### Atomic Test 5: WMI Win32_Product Class - Execute Local MSI file with embedded JScript

Executes an MSI containing embedded JScript code using the WMI Win32_Product class

**Supported Platforms:** windows

```powershell
Invoke-CimMethod -ClassName Win32_Product -MethodName #{action} -Arguments @{ PackageLocation = '#{msi_payload}' }
```

**Dependencies:**

- The MSI file must exist on disk at specified location (#{msi_payload})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Msiexec by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1218.007 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

Consider disabling the <code>AlwaysInstallElevated</code> policy to prevent elevated execution of Windows Installer packages.

### M1026 Privileged Account Management

Restrict execution of Msiexec.exe to privileged accounts or groups that need to use it to lessen the opportunities for malicious usage.

## Detection

### Detection of Msiexec Abuse for Local, Network, and DLL Execution

## Risk Assessment

| Finding                      | Severity | Impact          |
| ---------------------------- | -------- | --------------- |
| Msiexec technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [TrendMicro Msiexec Feb 2018](https://blog.trendmicro.com/trendlabs-security-intelligence/attack-using-windows-installer-msiexec-exe-leads-lokibot/)
- [LOLBAS Msiexec](https://lolbas-project.github.io/lolbas/Binaries/Msiexec/)
- [Microsoft msiexec](https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/msiexec)
- [Microsoft AlwaysInstallElevated 2018](https://docs.microsoft.com/en-us/windows/win32/msi/alwaysinstallelevated)
- [Atomic Red Team - T1218.007](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1218.007)
- [MITRE ATT&CK - T1218.007](https://attack.mitre.org/techniques/T1218/007)
