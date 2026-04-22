---
name: "T1003.001_lsass-memory"
description: "Adversaries may attempt to access credential material stored in the process memory of the Local Security Authority Subsystem Service (LSASS)."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1003.001
  - credential-access
  - windows
  - sub-technique
technique_id: "T1003.001"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1003/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1003
  - T1003.002
  - T1003.003
  - T1003.004
  - T1003.005
  - T1003.006
  - T1003.007
  - T1003.008
prerequisites:
  - T1003
severity_boost:
  T1003: "Chain with T1003 for deeper attack path"
  T1003.002: "Chain with T1003.002 for deeper attack path"
  T1003.003: "Chain with T1003.003 for deeper attack path"
---

# T1003.001 LSASS Memory

> **Sub-technique of:** T1003

## High-Level Description

Adversaries may attempt to access credential material stored in the process memory of the Local Security Authority Subsystem Service (LSASS). After a user logs on, the system generates and stores a variety of credential materials in LSASS process memory. These credential materials can be harvested by an administrative user or SYSTEM and used to conduct Lateral Movement using Use Alternate Authentication Material.

As well as in-memory techniques, the LSASS process memory can be dumped from the target host and analyzed on a local system.

For example, on the target host use procdump:

* <code>procdump -ma lsass.exe lsass_dump</code>

Locally, mimikatz can be run using:

* <code>sekurlsa::Minidump lsassdump.dmp</code>
* <code>sekurlsa::logonPasswords</code>

Built-in Windows tools such as `comsvcs.dll` can also be used:

* <code>rundll32.exe C:\Windows\System32\comsvcs.dll MiniDump PID lsass.dmp full</code>

Similar to Image File Execution Options Injection, the silent process exit mechanism can be abused to create a memory dump of `lsass.exe` through Windows Error Reporting (`WerFault.exe`).

Windows Security Support Provider (SSP) DLLs are loaded into LSASS process at system start. Once loaded into the LSA, SSP DLLs have access to encrypted and plaintext passwords that are stored in Windows, such as any logged-on user's Domain password or smart card PINs. The SSP configuration is stored in two Registry keys: <code>HKLM\SYSTEM\CurrentControlSet\Control\Lsa\Security Packages</code> and <code>HKLM\SYSTEM\CurrentControlSet\Control\Lsa\OSConfig\Security Packages</code>. An adversary may modify these Registry keys to add new SSPs, which will be loaded the next time the system boots, or when the AddSecurityPackage Windows API function is called.

The following SSPs can be used to access credentials:

* Msv: Interactive logons, batch logons, and service logons are done through the MSV authentication package.
* Wdigest: The Digest Authentication protocol is designed for use with Hypertext Transfer Protocol (HTTP) and Simple Authentication Security Layer (SASL) exchanges.
* Kerberos: Preferred for mutual client-server domain authentication in Windows 2000 and later.
* CredSSP: Provides SSO and Network Level Authentication for Remote Desktop Services.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows

## What to Check

- [ ] Identify if LSASS Memory technique is applicable to target environment
- [ ] Check Windows systems for indicators of LSASS Memory
- [ ] Verify mitigations are bypassed or absent (7 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Dump LSASS.exe Memory using ProcDump

The memory of lsass.exe is often dumped for offline credential theft attacks. This can be achieved with Sysinternals
ProcDump.

Upon successful execution, you should see the following file created c:\windows\temp\lsass_dump.dmp.

If you see a message saying "procdump.exe is not recognized as an internal or external command", try using the  get-prereq_commands to download and install the ProcDump tool first.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
"#{procdump_exe}" -accepteula -ma lsass.exe #{output_file}
```

**Dependencies:**
- ProcDump tool from Sysinternals must exist on disk at specified location (#{procdump_exe})

### Atomic Test 2: Dump LSASS.exe Memory using comsvcs.dll

The memory of lsass.exe is often dumped for offline credential theft attacks. This can be achieved with a built-in dll.

Upon successful execution, you should see the following file created $env:TEMP\lsass-comsvcs.dmp.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
C:\Windows\System32\rundll32.exe C:\windows\System32\comsvcs.dll, MiniDump (Get-Process lsass).id $env:TEMP\lsass-comsvcs.dmp full
```

### Atomic Test 3: Dump LSASS.exe Memory using direct system calls and API unhooking

The memory of lsass.exe is often dumped for offline credential theft attacks. This can be achieved using direct system calls and API unhooking in an effort to avoid detection. 
https://github.com/outflanknl/Dumpert
https://outflank.nl/blog/2019/06/19/red-team-tactics-combining-direct-system-calls-and-srdi-to-bypass-av-edr/
Upon successful execution, you should see the following file created C:\\windows\\temp\\dumpert.dmp.

If you see a message saying \"The system cannot find the path specified.\", try using the  get-prereq_commands to download the  tool first.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
"#{dumpert_exe}"
```

**Dependencies:**
- Dumpert executable must exist on disk at specified location (#{dumpert_exe})

### Atomic Test 4: Dump LSASS.exe Memory using NanoDump

The NanoDump tool uses syscalls and an invalid dump signature to avoid detection.

https://github.com/helpsystems/nanodump

Upon successful execution, you should find the nanondump.dmp file in the temp directory

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
PathToAtomicsFolder\..\ExternalPayloads\nanodump.x64.exe -w "%temp%\nanodump.dmp"
```

**Dependencies:**
- NanoDump executable must exist on disk at specified location (PathToAtomicsFolder\..\ExternalPayloads\nanodump.x64.exe)

### Atomic Test 5: Dump LSASS.exe Memory using Windows Task Manager

The memory of lsass.exe is often dumped for offline credential theft attacks. This can be achieved with the Windows Task
Manager and administrative permissions.

**Supported Platforms:** windows


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to LSASS Memory by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1003.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1028 Operating System Configuration
Consider disabling or restricting NTLM. Consider disabling WDigest authentication.

### M1043 Credential Access Protection
With Windows 10, Microsoft implemented new protections called Credential Guard to protect the LSA secrets that can be used to obtain credentials through forms of credential dumping. It is not configured by default and has hardware and firmware system requirements. It also does not protect against all forms of credential dumping.

### M1025 Privileged Process Integrity
On Windows 8.1 and Windows Server 2012 R2, enable Protected Process Light for LSA.

### M1026 Privileged Account Management
Do not put user or admin domain accounts in the local administrator groups across systems unless they are tightly controlled, as this is often equivalent to having a local administrator account with the same password on all systems. Follow best practices for design and administration of an enterprise network to limit privileged account use across administrative tiers.

### M1017 User Training
Limit credential overlap across accounts and systems by training users and administrators not to use the same password for multiple accounts.

### M1040 Behavior Prevention on Endpoint
On Windows 10, enable Attack Surface Reduction (ASR) rules to secure LSASS and prevent credential stealing.

### M1027 Password Policies
Ensure that local administrator accounts have complex, unique passwords across all systems on the network.


## Detection

### Detection of Credential Dumping from LSASS Memory via Access and Dump Sequence


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| LSASS Memory technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [Medium Detecting Attempts to Steal Passwords from Memory](https://medium.com/threatpunter/detecting-attempts-to-steal-passwords-from-memory-558f16dce4ea)
- [Deep Instinct LSASS](https://www.deepinstinct.com/blog/lsass-memory-dumps-are-stealthier-than-ever-before-part-2)
- [Graeber 2014](http://docplayer.net/20839173-Analysis-of-malicious-security-support-provider-dlls.html)
- [Volexity Exchange Marauder March 2021](https://www.volexity.com/blog/2021/03/02/active-exploitation-of-microsoft-exchange-zero-day-vulnerabilities/)
- [Powersploit](https://github.com/mattifestation/PowerSploit)
- [Symantec Attacks Against Government Sector](https://symantec.broadcom.com/hubfs/Attacks-Against-Government-Sector.pdf)
- [TechNet Blogs Credential Protection](https://blogs.technet.microsoft.com/askpfeplat/2016/04/18/the-importance-of-kb2871997-and-kb2928120-for-credential-protection/)
- [Atomic Red Team - T1003.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1003.001)
- [MITRE ATT&CK - T1003.001](https://attack.mitre.org/techniques/T1003/001)
