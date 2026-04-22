---
name: "T1112_modify-registry"
description: "Adversaries may interact with the Windows Registry as part of a variety of other techniques to aid in defense evasion, persistence, and execution."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1112
  - defense-evasion
  - persistence
  - windows
technique_id: "T1112"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1112"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1112 Modify Registry

## High-Level Description

Adversaries may interact with the Windows Registry as part of a variety of other techniques to aid in defense evasion, persistence, and execution.

Access to specific areas of the Registry depends on account permissions, with some keys requiring administrator-level access. The built-in Windows command-line utility Reg may be used for local or remote Registry modification. Other tools, such as remote access tools, may also contain functionality to interact with the Registry through the Windows API.

The Registry may be modified in order to hide configuration information or malicious payloads via Obfuscated Files or Information. The Registry may also be modified to Impair Defenses, such as by enabling macros for all Microsoft Office products, allowing privilege escalation without alerting the user, increasing the maximum number of allowed outbound requests, and/or modifying systems to store plaintext credentials in memory.

The Registry of a remote system may be modified to aid in execution of files as part of lateral movement. It requires the remote Registry service to be running on the target system. Often Valid Accounts are required, along with access to the remote system's SMB/Windows Admin Shares for RPC communication.

Finally, Registry modifications may also include actions to hide keys, such as prepending key names with a null character, which will cause an error and/or be ignored when read via Reg or other utilities using the Win32 API. Adversaries may abuse these pseudo-hidden keys to conceal payloads/commands used to maintain persistence.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if Modify Registry technique is applicable to target environment
- [ ] Check Windows systems for indicators of Modify Registry
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Modify Registry of Current User Profile - cmd

Modify the registry of the currently logged in user using reg.exe via cmd console. Upon execution, the message "The operation completed successfully."
will be displayed. Additionally, open Registry Editor to view the new entry in HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced.

**Supported Platforms:** windows

```cmd
reg add HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced /t REG_DWORD /v HideFileExt /d 1 /f
```

### Atomic Test 2: Modify Registry of Local Machine - cmd

Modify the Local Machine registry RUN key to change Windows Defender executable that should be ran on startup.  This should only be possible when
CMD is ran as Administrative rights. Upon execution, the message "The operation completed successfully."
will be displayed. Additionally, open Registry Editor to view the modified entry in HKLM\Software\Microsoft\Windows\CurrentVersion\Run.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
reg add HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Run /t REG_EXPAND_SZ /v SecurityHealth /d #{new_executable} /f
```

### Atomic Test 3: Modify registry to store logon credentials

Sets registry key that will tell windows to store plaintext passwords (making the system vulnerable to clear text / cleartext password dumping).
Upon execution, the message "The operation completed successfully." will be displayed.
Additionally, open Registry Editor to view the modified entry in HKLM\SYSTEM\CurrentControlSet\Control\SecurityProviders\WDigest.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
reg add HKLM\SYSTEM\CurrentControlSet\Control\SecurityProviders\WDigest /v UseLogonCredential /t REG_DWORD /d 1 /f
```

### Atomic Test 4: Use Powershell to Modify registry to store logon credentials

Sets registry key using Powershell that will tell windows to store plaintext passwords (making the system vulnerable to clear text / cleartext password dumping).
Open Registry Editor to view the modified entry in HKLM\SYSTEM\CurrentControlSet\Control\SecurityProviders\WDigest.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Set-ItemProperty -Force -Path  'HKLM:\SYSTEM\CurrentControlSet\Control\SecurityProviders\WDigest' -Name  'UseLogonCredential' -Value '1' -ErrorAction Ignore
```

### Atomic Test 5: Add domain to Trusted sites Zone

Attackers may add a domain to the trusted site zone to bypass defenses. Doing this enables attacks such as c2 over office365.
Upon execution, details of the new registry entries will be displayed.
Additionally, open Registry Editor to view the modified entry in HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Internet Settings\ZoneMap\.

https://www.blackhat.com/docs/us-17/wednesday/us-17-Dods-Infecting-The-Enterprise-Abusing-Office365-Powershell-For-Covert-C2.pdf

**Supported Platforms:** windows

```powershell
$key= "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Internet Settings\ZoneMap\Domains\#{bad_domain}\"
$name ="bad-subdomain"
new-item $key -Name $name -Force
new-itemproperty $key$name -Name https -Value 2 -Type DWORD;
new-itemproperty $key$name -Name http  -Value 2 -Type DWORD;
new-itemproperty $key$name -Name *     -Value 2 -Type DWORD;
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Modify Registry by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1112 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1024 Restrict Registry Permissions
Ensure proper permissions are set for Registry hives to prevent users from modifying keys for system components that may lead to privilege escalation.


## Detection

### Behavior-Based Registry Modification Detection on Windows


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Modify Registry technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [CISA Russian Gov Critical Infra 2018](https://www.cisa.gov/news-events/alerts/2018/03/15/russian-government-cyber-activity-targeting-energy-and-other-critical-infrastructure-sectors)
- [CISA LockBit 2023](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-075a)
- [Avaddon Ransomware 2021](https://arxiv.org/pdf/2102.04796)
- [Microsoft BlackCat Jun 2022](https://www.microsoft.com/en-us/security/blog/2022/06/13/the-many-lives-of-blackcat-ransomware/)
- [Microsoft Reg](https://technet.microsoft.com/en-us/library/cc732643.aspx)
- [Microsoft Remote](https://technet.microsoft.com/en-us/library/cc754820.aspx)
- [Microsoft 4657 APR 2017](https://docs.microsoft.com/windows/security/threat-protection/auditing/event-4657)
- [SpectorOps Hiding Reg Jul 2017](https://posts.specterops.io/hiding-registry-keys-with-psreflect-b18ec5ac8353)
- [Microsoft Reghide NOV 2006](https://docs.microsoft.com/sysinternals/downloads/reghide)
- [Microsoft RegDelNull July 2016](https://docs.microsoft.com/en-us/sysinternals/downloads/regdelnull)
- [TrendMicro POWELIKS AUG 2014](https://blog.trendmicro.com/trendlabs-security-intelligence/poweliks-malware-hides-in-windows-registry/)
- [Unit42 BabyShark Feb 2019](https://unit42.paloaltonetworks.com/new-babyshark-malware-targets-u-s-national-security-think-tanks/)
- [Atomic Red Team - T1112](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1112)
- [MITRE ATT&CK - T1112](https://attack.mitre.org/techniques/T1112)
