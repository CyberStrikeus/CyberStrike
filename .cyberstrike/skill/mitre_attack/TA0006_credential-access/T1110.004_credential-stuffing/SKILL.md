---
name: "T1110.004_credential-stuffing"
description: "Adversaries may use credentials obtained from breach dumps of unrelated accounts to gain access to target accounts through credential overlap."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1110.004
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
technique_id: "T1110.004"
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
mitre_url: "https://attack.mitre.org/techniques/T1110/004"
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
  - T1110.001
  - T1110.002
  - T1110.003
prerequisites:
  - T1110
severity_boost:
  T1110: "Chain with T1110 for deeper attack path"
  T1110.001: "Chain with T1110.001 for deeper attack path"
  T1110.002: "Chain with T1110.002 for deeper attack path"
---

# T1110.004 Credential Stuffing

> **Sub-technique of:** T1110

## High-Level Description

Adversaries may use credentials obtained from breach dumps of unrelated accounts to gain access to target accounts through credential overlap. Occasionally, large numbers of username and password pairs are dumped online when a website or service is compromised and the user account credentials accessed. The information may be useful to an adversary attempting to compromise accounts by taking advantage of the tendency for users to use the same passwords across personal and business accounts.

Credential stuffing is a risky option because it could cause numerous authentication failures and account lockouts, depending on the organization's login failure policies.

Typically, management services over commonly used ports are used when stuffing credentials. Commonly targeted services include the following:

* SSH (22/TCP)
* Telnet (23/TCP)
* FTP (21/TCP)
* NetBIOS / SMB / Samba (139/TCP & 445/TCP)
* LDAP (389/TCP)
* Kerberos (88/TCP)
* RDP / Terminal Services (3389/TCP)
* HTTP/HTTP Management Services (80/TCP & 443/TCP)
* MSSQL (1433/TCP)
* Oracle (1521/TCP)
* MySQL (3306/TCP)
* VNC (5900/TCP)

In addition to management services, adversaries may "target single sign-on (SSO) and cloud-based applications utilizing federated authentication protocols," as well as externally facing email applications, such as Office 365.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows, SaaS, IaaS, Linux, macOS, Containers, Network Devices, Office Suite, Identity Provider, ESXi

## What to Check

- [ ] Identify if Credential Stuffing technique is applicable to target environment
- [ ] Check Windows systems for indicators of Credential Stuffing
- [ ] Check SaaS systems for indicators of Credential Stuffing
- [ ] Check IaaS systems for indicators of Credential Stuffing
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: SSH Credential Stuffing From Linux

Using username,password combination from a password dump to login over SSH.

**Supported Platforms:** linux

```bash
cp "$PathToAtomicsFolder/T1110.004/src/credstuffuserpass.txt" /tmp/
for unamepass in $(cat /tmp/credstuffuserpass.txt);do sshpass -p `echo $unamepass | cut -d":" -f2` ssh -o 'StrictHostKeyChecking=no' `echo $unamepass | cut -d":" -f1`@#{target_host};done
```

**Dependencies:**
- Requires SSHPASS

### Atomic Test 2: SSH Credential Stuffing From MacOS

Using username,password combination from a password dump to login over SSH.

**Supported Platforms:** macos

```bash
cp "$PathToAtomicsFolder/T1110.004/src/credstuffuserpass.txt" /tmp/
for unamepass in $(cat /tmp/credstuffuserpass.txt);do sshpass -p `echo $unamepass | cut -d":" -f2` ssh -o 'StrictHostKeyChecking=no' `echo $unamepass | cut -d":" -f1`@#{target_host};done
```

**Dependencies:**
- Requires SSHPASS

### Atomic Test 3: SSH Credential Stuffing From FreeBSD

Using username,password combination from a password dump to login over SSH.

**Supported Platforms:** linux

```bash
cp $PathToAtomicsFolder/T1110.004/src/credstuffuserpass.txt /tmp/
for unamepass in $(cat /tmp/credstuffuserpass.txt);do sshpass -p `echo $unamepass | cut -d":" -f2` ssh -o 'StrictHostKeyChecking=no' `echo $unamepass | cut -d":" -f1`@#{target_host};done
```

**Dependencies:**
- Requires SSHPASS

### Atomic Test 4: Brute Force:Credential Stuffing using Kerbrute Tool

Will read username and password combos from a file or stdin (format username:password) and perform a bruteforce attack

**Supported Platforms:** windows

```powershell
cd "PathToAtomicsFolder\..\ExternalPayloads"
.\kerbrute.exe bruteforce --dc #{domaincontroller} -d #{domain} "PathToAtomicsFolder\..\ExternalPayloads\bruteforce.txt"
```

**Dependencies:**
- kerbrute.exe must exist in PathToAtomicsFolder\..\ExternalPayloads
- bruteforce.txt must exist in PathToAtomicsFolder\..\ExternalPayloads


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Credential Stuffing by examining the target platforms (Windows, SaaS, IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1110.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1036 Account Use Policies
Set account lockout policies after a certain number of failed login attempts to prevent passwords from being guessed. Too strict a policy may create a denial of service condition and render environments un-usable, with all accounts used in the brute force being locked-out. Use conditional access policies to block logins from non-compliant devices or from outside defined organization IP ranges. Consider blocking risky authentication requests, such as those originating from anonymizing services/proxies.

### M1027 Password Policies
Refer to NIST guidelines when creating password policies.

### M1018 User Account Management
Proactively reset accounts that are known to be part of breached credentials either immediately, or after detecting bruteforce attempts.

### M1032 Multi-factor Authentication
Use multi-factor authentication. Where possible, also enable multi-factor authentication on externally facing services.


## Detection

### Credential Stuffing Detection via Reused Breached Credentials Across Services


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Credential Stuffing technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [US-CERT TA18-068A 2018](https://www.us-cert.gov/ncas/alerts/TA18-086A)
- [Atomic Red Team - T1110.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1110.004)
- [MITRE ATT&CK - T1110.004](https://attack.mitre.org/techniques/T1110/004)
