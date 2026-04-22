---
name: "T1218.012_verclsid"
description: "Adversaries may abuse verclsid.exe to proxy execution of malicious code."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1218.012
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1218.012"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1218/012"
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
  - T1218.009
  - T1218.010
  - T1218.011
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

# T1218.012 Verclsid

> **Sub-technique of:** T1218

## High-Level Description

Adversaries may abuse verclsid.exe to proxy execution of malicious code. Verclsid.exe is known as the Extension CLSID Verification Host and is responsible for verifying each shell extension before they are used by Windows Explorer or the Windows Shell.

Adversaries may abuse verclsid.exe to execute malicious payloads. This may be achieved by running <code>verclsid.exe /S /C {CLSID}</code>, where the file is referenced by a Class ID (CLSID), a unique identification number used to identify COM objects. COM payloads executed by verclsid.exe may be able to perform various malicious actions, such as loading and executing COM scriptlets (SCT) from remote servers (similar to Regsvr32). Since the binary may be signed and/or native on Windows systems, proxying execution via verclsid.exe may bypass application control solutions that do not account for its potential abuse.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Verclsid technique is applicable to target environment
- [ ] Check Windows systems for indicators of Verclsid
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Verclsid by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1218.012 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1038 Execution Prevention

Use application control configured to block execution of verclsid.exe if it is not required for a given system or network to prevent potential misuse by adversaries.

### M1037 Filter Network Traffic

Consider modifying host firewall rules to prevent egress traffic from verclsid.exe.

### M1042 Disable or Remove Feature or Program

Consider removing verclsid.exe if it is not necessary within a given environment.

## Detection

### Detection Strategy for T1218.012 Verclsid Abuse

## Risk Assessment

| Finding                       | Severity | Impact          |
| ----------------------------- | -------- | --------------- |
| Verclsid technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [BOHOPS Abusing the COM Registry](https://bohops.com/2018/08/18/abusing-the-com-registry-structure-part-2-loading-techniques-for-evasion-and-persistence/)
- [Red Canary Verclsid.exe](https://redcanary.com/blog/verclsid-exe-threat-detection/)
- [LOLBAS Verclsid](https://lolbas-project.github.io/lolbas/Binaries/Verclsid/)
- [Nick Tyrer GitHub](https://gist.github.com/NickTyrer/0598b60112eaafe6d07789f7964290d5)
- [WinOSBite verclsid.exe](https://winosbite.com/verclsid-exe/)
- [Atomic Red Team - T1218.012](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1218.012)
- [MITRE ATT&CK - T1218.012](https://attack.mitre.org/techniques/T1218/012)
