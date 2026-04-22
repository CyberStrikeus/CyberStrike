---
name: "T1562_impair-defenses"
description: "Adversaries may maliciously modify components of a victim environment in order to hinder or disable defensive mechanisms."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1562
  - defense-evasion
  - windows
  - iaas
  - linux
  - macos
  - containers
  - network-devices
  - identity-provider
  - office-suite
  - esxi
technique_id: "T1562"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
  - IaaS
  - Linux
  - macOS
  - Containers
  - Network Devices
  - Identity Provider
  - Office Suite
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1562"
tech_stack:
  - windows
  - cloud
  - linux
  - macos
  - containers
  - network devices
  - identity
  - office
  - esxi
cwe_ids:
  - CWE-693
chains_with:
  - T1562.001
  - T1562.002
  - T1562.003
  - T1562.004
  - T1562.006
  - T1562.007
  - T1562.008
  - T1562.009
  - T1562.010
  - T1562.011
  - T1562.012
  - T1562.013
prerequisites:
  []
severity_boost:
  T1562.001: "Chain with T1562.001 for deeper attack path"
  T1562.002: "Chain with T1562.002 for deeper attack path"
  T1562.003: "Chain with T1562.003 for deeper attack path"
---

# T1562 Impair Defenses

## High-Level Description

Adversaries may maliciously modify components of a victim environment in order to hinder or disable defensive mechanisms. This not only involves impairing preventative defenses, such as firewalls and anti-virus, but also detection capabilities that defenders can use to audit activity and identify malicious behavior. This may also span both native defenses as well as supplemental capabilities installed by users and administrators.

Adversaries may also impair routine operations that contribute to defensive hygiene, such as blocking users from logging out, preventing a system from shutting down, or disabling or modifying the update process. Adversaries could also target event aggregation and analysis mechanisms, or otherwise disrupt these procedures by altering other system components. These restrictions can further enable malicious operations as well as the continued propagation of incidents.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows, IaaS, Linux, macOS, Containers, Network Devices, Identity Provider, Office Suite, ESXi

## What to Check

- [ ] Identify if Impair Defenses technique is applicable to target environment
- [ ] Check Windows systems for indicators of Impair Defenses
- [ ] Check IaaS systems for indicators of Impair Defenses
- [ ] Check Linux systems for indicators of Impair Defenses
- [ ] Verify mitigations are bypassed or absent (7 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Windows Disable LSA Protection

The following Atomic adds a registry entry to disable LSA Protection.

The LSA controls and manages user rights information, password hashes and other important bits of information in memory. Attacker tools, such as mimikatz, rely on accessing this content to scrape password hashes or clear-text passwords. Enabling LSA Protection configures Windows to control the information stored in memory in a more secure fashion - specifically, to prevent non-protected processes from accessing that data.
Upon successful execution, the registry will be modified and RunAsPPL will be set to 0, disabling Lsass protection.
https://learn.microsoft.com/en-us/windows-server/security/credentials-protection-and-management/configuring-additional-lsa-protection#how-to-disable-lsa-protection
https://blog.netwrix.com/2022/01/11/understanding-lsa-protection/
https://thedfirreport.com/2022/03/21/phosphorus-automates-initial-access-using-proxyshell/

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
reg add HKLM\SYSTEM\CurrentControlSet\Control\LSA /v RunAsPPL /t REG_DWORD /d 0 /f
```

### Atomic Test 2: Disable journal logging via systemctl utility

The atomic test disables the journal logging using built-in systemctl utility

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo systemctl stop systemd-journald #disables journal logging
```

### Atomic Test 3: Disable journal logging via sed utility

The atomic test disables the journal logging by searching and replacing the "Storage" parameter to "none" within the journald.conf file, thus any new journal entries will only be temporarily available in memory and not written to disk

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo sed -i 's/Storage=auto/Storage=none/' /etc/systemd/journald.conf
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Impair Defenses by examining the target platforms (Windows, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1562 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1054 Software Configuration
Consider implementing policies on internal web servers, such HTTP Strict Transport Security, that enforce the use of HTTPS/network traffic encryption to prevent insecure connections.

### M1018 User Account Management
Ensure proper user permissions are in place to prevent adversaries from disabling or interfering with security/logging services.

### M1038 Execution Prevention
Use application control where appropriate, especially regarding the execution of tools outside of the organization's security policies (such as rootkit removal tools) that have been abused to impair system defenses. Ensure that only approved security applications are used and running on enterprise systems.

### M1022 Restrict File and Directory Permissions
Ensure proper process and file permissions are in place to prevent adversaries from disabling or interfering with security/logging services.

### M1024 Restrict Registry Permissions
Ensure proper Registry permissions are in place to prevent adversaries from disabling or interfering with security/logging services.

### M1047 Audit
Routinely check account role permissions to ensure only expected users and roles have permission to modify defensive tools and settings. Periodically verify that tools such as EDRs are functioning as expected.

### M1042 Disable or Remove Feature or Program
Consider removing previous versions of tools that are unnecessary to the environment when possible.


## Detection

### Detection Strategy for Impair Defenses Across Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Impair Defenses technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Google Cloud Mandiant UNC3886 2024](https://cloud.google.com/blog/topics/threat-intelligence/uncovering-unc3886-espionage-operations)
- [Emotet shutdown](https://thedfirreport.com/2022/11/28/emotet-strikes-again-lnk-file-leads-to-domain-wide-ransomware/)
- [Atomic Red Team - T1562](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1562)
- [MITRE ATT&CK - T1562](https://attack.mitre.org/techniques/T1562)
