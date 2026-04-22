---
name: "T1218.009_regsvcsregasm"
description: "Adversaries may abuse Regsvcs and Regasm to proxy execution of code through a trusted Windows utility."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1218.009
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1218.009"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1218/009"
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
  - T1218.007
  - T1218.008
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

# T1218.009 Regsvcs/Regasm

> **Sub-technique of:** T1218

## High-Level Description

Adversaries may abuse Regsvcs and Regasm to proxy execution of code through a trusted Windows utility. Regsvcs and Regasm are Windows command-line utilities that are used to register .NET Component Object Model (COM) assemblies. Both are binaries that may be digitally signed by Microsoft.

Both utilities may be used to bypass application control through use of attributes within the binary to specify code that should be run before registration or unregistration: <code>[ComRegisterFunction]</code> or <code>[ComUnregisterFunction]</code> respectively. The code with the registration and unregistration attributes will be executed even if the process is run under insufficient privileges and fails to execute.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Regsvcs/Regasm technique is applicable to target environment
- [ ] Check Windows systems for indicators of Regsvcs/Regasm
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Regasm Uninstall Method Call Test

Executes the Uninstall Method, No Admin Rights Required. Upon execution, "I shouldn't really execute either." will be displayed.

**Supported Platforms:** windows

```cmd
C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe /r:System.EnterpriseServices.dll /out:"#{output_file}" /target:library "#{source_file}"
C:\Windows\Microsoft.NET\Framework\v4.0.30319\regasm.exe /U #{output_file}
```

**Dependencies:**

- The CSharp source file must exist on disk at specified location (#{source_file})

### Atomic Test 2: Regsvcs Uninstall Method Call Test

Executes the Uninstall Method, No Admin Rights Required, Requires SNK. Upon execution, "I shouldn't really execute" will be displayed
along with other information about the assembly being installed.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$key = 'BwIAAAAkAABSU0EyAAQAAAEAAQBhXtvkSeH85E31z64cAX+X2PWGc6DHP9VaoD13CljtYau9SesUzKVLJdHphY5ppg5clHIGaL7nZbp6qukLH0lLEq/vW979GWzVAgSZaGVCFpuk6p1y69cSr3STlzljJrY76JIjeS4+RhbdWHp99y8QhwRllOC0qu/WxZaffHS2te/PKzIiTuFfcP46qxQoLR8s3QZhAJBnn9TGJkbix8MTgEt7hD1DC2hXv7dKaC531ZWqGXB54OnuvFbD5P2t+vyvZuHNmAy3pX0BDXqwEfoZZ+hiIk1YUDSNOE79zwnpVP1+BN0PK5QCPCS+6zujfRlQpJ+nfHLLicweJ9uT7OG3g/P+JpXGN0/+Hitolufo7Ucjh+WvZAU//dzrGny5stQtTmLxdhZbOsNDJpsqnzwEUfL5+o8OhujBHDm/ZQ0361mVsSVWrmgDPKHGGRx+7FbdgpBEq3m15/4zzg343V9NBwt1+qZU+TSVPU0wRvkWiZRerjmDdehJIboWsx4V8aiWx8FPPngEmNz89tBAQ8zbIrJFfmtYnj1fFmkNu3lglOefcacyYEHPX/tqcBuBIg/cpcDHps/6SGCCciX3tufnEeDMAQjmLku8X4zHcgJx6FpVK7qeEuvyV0OGKvNor9b/WKQHIHjkzG+z6nWHMoMYV5VMTZ0jLM5aZQ6ypwmFZaNmtL6KDzKv8L1YN2TkKjXEoWulXNliBpelsSJyuICplrCTPGGSxPGihT3rpZ9tbLZUefrFnLNiHfVjNi53Yg4='
$Content = [System.Convert]::FromBase64String($key)
Set-Content $env:Temp\key.snk -Value $Content -Encoding Byte
C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe /r:System.EnterpriseServices.dll /out:"#{output_file}" /target:library /keyfile:$env:Temp\key.snk #{source_file}
C:\Windows\Microsoft.NET\Framework\v4.0.30319\regsvcs.exe #{output_file}
```

**Dependencies:**

- The CSharp source file must exist on disk at specified location (#{source_file})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Regsvcs/Regasm by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1218.009 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention

Block execution of Regsvcs.exe and Regasm.exe if they are not required for a given system or network to prevent potential misuse by adversaries.

### M1042 Disable or Remove Feature or Program

Regsvcs and Regasm may not be necessary within a given environment.

## Detection

### Detecting .NET COM Registration Abuse via Regsvcs/Regasm

## Risk Assessment

| Finding                             | Severity | Impact          |
| ----------------------------------- | -------- | --------------- |
| Regsvcs/Regasm technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [MSDN Regsvcs](https://msdn.microsoft.com/en-us/library/04za0hca.aspx)
- [MSDN Regasm](https://msdn.microsoft.com/en-us/library/tzat5yw6.aspx)
- [LOLBAS Regsvcs](https://lolbas-project.github.io/lolbas/Binaries/Regsvcs/)
- [LOLBAS Regasm](https://lolbas-project.github.io/lolbas/Binaries/Regasm/)
- [Atomic Red Team - T1218.009](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1218.009)
- [MITRE ATT&CK - T1218.009](https://attack.mitre.org/techniques/T1218/009)
