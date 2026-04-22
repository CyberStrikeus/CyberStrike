---
name: "T1218.014_mmc"
description: "Adversaries may abuse mmc.exe to proxy execution of malicious .msc files."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1218.014
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1218.014"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1218/014"
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
  - T1218.012
  - T1218.013
  - T1218.015
prerequisites:
  - T1218
severity_boost:
  T1218: "Chain with T1218 for deeper attack path"
  T1218.001: "Chain with T1218.001 for deeper attack path"
  T1218.002: "Chain with T1218.002 for deeper attack path"
---

# T1218.014 MMC

> **Sub-technique of:** T1218

## High-Level Description

Adversaries may abuse mmc.exe to proxy execution of malicious .msc files. Microsoft Management Console (MMC) is a binary that may be signed by Microsoft and is used in several ways in either its GUI or in a command prompt. MMC can be used to create, open, and save custom consoles that contain administrative tools created by Microsoft, called snap-ins. These snap-ins may be used to manage Windows systems locally or remotely. MMC can also be used to open Microsoft created .msc files to manage system configuration.

For example, <code>mmc C:\Users\foo\admintools.msc /a</code> will open a custom, saved console msc file in author mode. Another common example is <code>mmc gpedit.msc</code>, which will open the Group Policy Editor application window. 

Adversaries may use MMC commands to perform malicious tasks. For example, <code>mmc wbadmin.msc delete catalog -quiet</code> deletes the backup catalog on the system (i.e. Inhibit System Recovery) without prompts to the user (Note: <code>wbadmin.msc</code> may only be present by default on Windows Server operating systems).

Adversaries may also abuse MMC to execute malicious .msc files. For example, adversaries may first create a malicious registry Class Identifier (CLSID) subkey, which uniquely identifies a Component Object Model class object. Then, adversaries may create custom consoles with the “Link to Web Address” snap-in that is linked to the malicious CLSID subkey. Once the .msc file is saved, adversaries may invoke the malicious CLSID payload with the following command: <code>mmc.exe -Embedding C:\path\to\test.msc</code>.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if MMC technique is applicable to target environment
- [ ] Check Windows systems for indicators of MMC
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to MMC by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1218.014 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1042 Disable or Remove Feature or Program
MMC may not be necessary within a given environment since it is primarily used by system administrators, not regular users or clients.

### M1038 Execution Prevention
Use application control configured to block execution of MMC if it is not required for a given system or network to prevent potential misuse by adversaries.


## Detection

### Detecting MMC (.msc) Proxy Execution and Malicious COM Activation


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| MMC technique applicable | Medium | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [abusing_com_reg](https://bohops.com/2018/08/18/abusing-the-com-registry-structure-part-2-loading-techniques-for-evasion-and-persistence/)
- [mmc_vulns](https://research.checkpoint.com/2019/microsoft-management-console-mmc-vulnerabilities/)
- [win_msc_files_overview](https://www.ghacks.net/2017/06/10/windows-msc-files-overview/)
- [win_mmc](https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/mmc)
- [win_wbadmin_delete_catalog](https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/wbadmin-delete-catalog)
- [win_clsid_key](https://docs.microsoft.com/en-us/windows/win32/com/clsid-key-hklm)
- [what_is_mmc](https://docs.microsoft.com/en-us/troubleshoot/windows-server/system-management-components/what-is-microsoft-management-console)
- [phobos_virustotal](https://www.virustotal.com/gui/file/0b4c743246478a6a8c9fa3ff8e04f297507c2f0ea5d61a1284fe65387d172f81/detection)
- [Atomic Red Team - T1218.014](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1218.014)
- [MITRE ATT&CK - T1218.014](https://attack.mitre.org/techniques/T1218/014)
