---
name: "T1201_password-policy-discovery"
description: "Adversaries may attempt to access detailed information about the password policy used within an enterprise network or cloud environment."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1201
  - discovery
  - windows
  - linux
  - macos
  - iaas
  - network-devices
  - identity-provider
  - saas
  - office-suite
technique_id: "T1201"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Windows
  - Linux
  - macOS
  - IaaS
  - Network Devices
  - Identity Provider
  - SaaS
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1201"
tech_stack:
  - windows
  - linux
  - macos
  - cloud
  - network devices
  - identity
  - saas
  - office
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1201 Password Policy Discovery

## High-Level Description

Adversaries may attempt to access detailed information about the password policy used within an enterprise network or cloud environment. Password policies are a way to enforce complex passwords that are difficult to guess or crack through Brute Force. This information may help the adversary to create a list of common passwords and launch dictionary and/or brute force attacks which adheres to the policy (e.g. if the minimum password length should be 8, then not trying passwords such as 'pass123'; not checking for more than 3-4 passwords per account if the lockout is set to 6 as to not lock out accounts).

Password policies can be set and discovered on Windows, Linux, and macOS systems via various command shell utilities such as <code>net accounts (/domain)</code>, <code>Get-ADDefaultDomainPasswordPolicy</code>, <code>chage -l <username></code>, <code>cat /etc/pam.d/common-password</code>, and <code>pwpolicy getaccountpolicies</code> . Adversaries may also leverage a Network Device CLI on network devices to discover password policy information (e.g. <code>show aaa</code>, <code>show aaa common-criteria policy all</code>).

Password policies can be discovered in cloud environments using available APIs such as <code>GetAccountPasswordPolicy</code> in AWS .

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Windows, Linux, macOS, IaaS, Network Devices, Identity Provider, SaaS, Office Suite

## What to Check

- [ ] Identify if Password Policy Discovery technique is applicable to target environment
- [ ] Check Windows systems for indicators of Password Policy Discovery
- [ ] Check Linux systems for indicators of Password Policy Discovery
- [ ] Check macOS systems for indicators of Password Policy Discovery
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Examine password complexity policy - Ubuntu

Lists the password complexity policy to console on Ubuntu Linux.

**Supported Platforms:** linux

```bash
cat /etc/pam.d/common-password
```

### Atomic Test 2: Examine password complexity policy - FreeBSD

Lists the password complexity policy to console on FreeBSD.

**Supported Platforms:** linux

```bash
cat /etc/pam.d/passwd
```

### Atomic Test 3: Examine password complexity policy - CentOS/RHEL 7.x

Lists the password complexity policy to console on CentOS/RHEL 7.x Linux.

**Supported Platforms:** linux

```bash
cat /etc/security/pwquality.conf
```

**Dependencies:**

- System must be CentOS or RHEL v7

### Atomic Test 4: Examine password complexity policy - CentOS/RHEL 6.x

Lists the password complexity policy to console on CentOS/RHEL 6.x Linux.

**Supported Platforms:** linux

```bash
cat /etc/pam.d/system-auth
cat /etc/security/pwquality.conf
```

**Dependencies:**

- System must be CentOS or RHEL v6

### Atomic Test 5: Examine password expiration policy - All Linux

Lists the password expiration policy to console on CentOS/RHEL/Ubuntu.

**Supported Platforms:** linux

```bash
cat /etc/login.defs
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Password Policy Discovery by examining the target platforms (Windows, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1201 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1027 Password Policies

Ensure only valid password filters are registered. Filter DLLs must be present in Windows installation directory (<code>C:\Windows\System32\</code> by default) of a domain controller and/or local computer with a corresponding entry in <code>HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Lsa\Notification Packages</code>.

## Detection

### Password Policy Discovery – cross-platform behavior-chain analytics

## Risk Assessment

| Finding                                        | Severity | Impact    |
| ---------------------------------------------- | -------- | --------- |
| Password Policy Discovery technique applicable | Medium   | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [AWS GetPasswordPolicy](https://docs.aws.amazon.com/IAM/latest/APIReference/API_GetAccountPasswordPolicy.html)
- [Jamf User Password Policies](https://www.jamf.com/jamf-nation/discussions/18574/user-password-policies-on-non-ad-machines)
- [Superuser Linux Password Policies](https://superuser.com/questions/150675/how-to-display-password-policy-information-for-a-user-ubuntu)
- [US-CERT-TA18-106A](https://www.us-cert.gov/ncas/alerts/TA18-106A)
- [Atomic Red Team - T1201](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1201)
- [MITRE ATT&CK - T1201](https://attack.mitre.org/techniques/T1201)
