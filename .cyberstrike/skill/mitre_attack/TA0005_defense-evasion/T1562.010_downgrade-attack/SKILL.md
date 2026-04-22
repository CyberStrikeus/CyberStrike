---
name: "T1562.010_downgrade-attack"
description: "Adversaries may downgrade or use a version of system features that may be outdated, vulnerable, and/or does not support updated security controls."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1562.010
  - defense-evasion
  - windows
  - linux
  - macos
  - sub-technique
technique_id: "T1562.010"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1562/010"
tech_stack:
  - windows
  - linux
  - macos
cwe_ids:
  - CWE-693
chains_with:
  - T1562
  - T1562.001
  - T1562.002
  - T1562.003
  - T1562.004
  - T1562.006
  - T1562.007
  - T1562.008
  - T1562.009
  - T1562.011
  - T1562.012
  - T1562.013
prerequisites:
  - T1562
severity_boost:
  T1562: "Chain with T1562 for deeper attack path"
  T1562.001: "Chain with T1562.001 for deeper attack path"
  T1562.002: "Chain with T1562.002 for deeper attack path"
---

# T1562.010 Downgrade Attack

> **Sub-technique of:** T1562

## High-Level Description

Adversaries may downgrade or use a version of system features that may be outdated, vulnerable, and/or does not support updated security controls. Downgrade attacks typically take advantage of a system’s backward compatibility to force it into less secure modes of operation. 

Adversaries may downgrade and use various less-secure versions of features of a system, such as Command and Scripting Interpreters or even network protocols that can be abused to enable Adversary-in-the-Middle or Network Sniffing. For example, PowerShell versions 5+ includes Script Block Logging (SBL), which can record executed script content. However, adversaries may attempt to execute a previous version of PowerShell that does not support SBL with the intent to Impair Defenses while running malicious scripts that may have otherwise been detected.

Adversaries may similarly target network traffic to downgrade from an encrypted HTTPS connection to an unsecured HTTP connection that exposes network data in clear text. On Windows systems, adversaries may downgrade the boot manager to a vulnerable version that bypasses Secure Boot, granting the ability to disable various operating system security mechanisms.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows, Linux, macOS

## What to Check

- [ ] Identify if Downgrade Attack technique is applicable to target environment
- [ ] Check Windows systems for indicators of Downgrade Attack
- [ ] Check Linux systems for indicators of Downgrade Attack
- [ ] Check macOS systems for indicators of Downgrade Attack
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: ESXi - Change VIB acceptance level to CommunitySupported via PowerCLI

An adversary can change the VIB acceptance level to CommunitySupported to downgrade the acceptance criteria.This can be accomplished via PowerCLI. Afterwards an adversary may proceed to installing malicious VIBs on the host.
[Reference](https://www.mandiant.com/resources/blog/esxi-hypervisors-detection-hardening)

**Supported Platforms:** linux
**Elevation Required:** Yes

```powershell
Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -ParticipateInCEIP:$false -Confirm:$false 
Connect-VIServer -Server #{vm_host} -User #{vm_user} -Password #{vm_pass}
(Get-EsxCli -VMHost #{vm_host} -V2).software.acceptance.set.Invoke(@{level = "CommunitySupported"})
Disconnect-VIServer -Confirm:$false
```

**Dependencies:**
- Check if VMWARE PowerCLI PowerShell Module is installed.

### Atomic Test 2: ESXi - Change VIB acceptance level to CommunitySupported via ESXCLI

An adversary will change the VIB acceptance level to CommunitySupported to downgrade the acceptance criteria via ESXCLI. Afterwards an adversary may proceed to installing malicious VIBs on the host.
[Reference](https://www.mandiant.com/resources/blog/esxi-hypervisors-detection-hardening)

**Supported Platforms:** windows

```cmd
echo "" | "#{plink_file}" "#{vm_host}" -ssh  -l "#{vm_user}" -pw "#{vm_pass}" -m "#{cli_script}"
```

**Dependencies:**
- Check if plink is available.

### Atomic Test 3: PowerShell Version 2 Downgrade

Executes outdated PowerShell Version 2 which does not support security features like AMSI. By default the atomic will attempt to execute the cmdlet Invoke-Mimikatz whether it exists or not, as this cmdlet will be blocked by AMSI when active.

**Supported Platforms:** windows

```powershell
PowerShell -version 2 -command '#{v2_command}'
```

**Dependencies:**
- Check if Version 2 is installed.


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Downgrade Attack by examining the target platforms (Windows, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1562.010 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1054 Software Configuration
Consider implementing policies on internal web servers, such HTTP Strict Transport Security, that enforce the use of HTTPS/network traffic encryption to prevent insecure connections.

### M1042 Disable or Remove Feature or Program
Consider removing previous versions of tools that are unnecessary to the environment when possible.


## Detection

### Detecting Downgrade Attacks


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Downgrade Attack technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [SafeBreach](https://www.safebreach.com/blog/downgrade-attacks-using-windows-updates/)
- [Crowdstrike Downgrade](https://www.crowdstrike.com/cybersecurity-101/attack-types/downgrade-attacks/)
- [Targeted SSL Stripping Attacks Are Real](https://blog.checkpoint.com/research/targeted-ssl-stripping-attacks-are-real/amp/)
- [CrowdStrike BGH Ransomware 2021](https://www.crowdstrike.com/blog/how-falcon-complete-stopped-a-big-game-hunting-ransomware-attack/)
- [att_def_ps_logging](https://nsfocusglobal.com/attack-and-defense-around-powershell-event-logging/)
- [inv_ps_attacks](https://powershellmagazine.com/2014/07/16/investigating-powershell-attacks/)
- [Mandiant BYOL 2018](https://www.mandiant.com/resources/bring-your-own-land-novel-red-teaming-technique)
- [welivesecurity](https://www.welivesecurity.com/2023/03/01/blacklotus-uefi-bootkit-myth-confirmed/)
- [Microsoft Security](https://www.microsoft.com/en-us/security/blog/2023/04/11/guidance-for-investigating-attacks-using-cve-2022-21894-the-blacklotus-campaign/)
- [Praetorian TLS Downgrade Attack 2014](https://www.praetorian.com/blog/man-in-the-middle-tls-ssl-protocol-downgrade-attack/)
- [Atomic Red Team - T1562.010](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1562.010)
- [MITRE ATT&CK - T1562.010](https://attack.mitre.org/techniques/T1562/010)
