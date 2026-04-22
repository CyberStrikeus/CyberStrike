---
name: "T1552_unsecured-credentials"
description: "Adversaries may search compromised systems to find and obtain insecurely stored credentials."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1552
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
technique_id: "T1552"
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
mitre_url: "https://attack.mitre.org/techniques/T1552"
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
cwe_ids:
  - CWE-522
chains_with:
  - T1552.001
  - T1552.002
  - T1552.003
  - T1552.004
  - T1552.005
  - T1552.006
  - T1552.007
  - T1552.008
prerequisites:
  []
severity_boost:
  T1552.001: "Chain with T1552.001 for deeper attack path"
  T1552.002: "Chain with T1552.002 for deeper attack path"
  T1552.003: "Chain with T1552.003 for deeper attack path"
---

# T1552 Unsecured Credentials

## High-Level Description

Adversaries may search compromised systems to find and obtain insecurely stored credentials. These credentials can be stored and/or misplaced in many locations on a system, including plaintext files (e.g. Shell History), operating system or application-specific repositories (e.g. Credentials in Registry), or other specialized files/artifacts (e.g. Private Keys).

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows, SaaS, IaaS, Linux, macOS, Containers, Network Devices, Office Suite, Identity Provider

## What to Check

- [ ] Identify if Unsecured Credentials technique is applicable to target environment
- [ ] Check Windows systems for indicators of Unsecured Credentials
- [ ] Check SaaS systems for indicators of Unsecured Credentials
- [ ] Check IaaS systems for indicators of Unsecured Credentials
- [ ] Verify mitigations are bypassed or absent (11 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: AWS - Retrieve EC2 Password Data using stratus

This atomic runs an API call GetPasswordData from a role that does not have permission to do so. This simulates an attacker attempting to retrieve RDP passwords on a high number of Windows EC2 instances. This atomic test leverages a tool called stratus-red-team built by DataDog (https://github.com/DataDog/stratus-red-team). Stratus Red Team is a self-contained binary. You can use it to easily detonate offensive attack techniques against a live cloud environment. Ref: https://stratus-red-team.cloud/attack-techniques/AWS/aws.credential-access.ec2-get-password-data/

**Supported Platforms:** linux, macos, iaas:aws

```bash
export AWS_REGION=#{aws_region} 
cd #{stratus_path}
echo "starting warmup"
./stratus warmup aws.credential-access.ec2-get-password-data
echo "starting detonate"
./stratus detonate aws.credential-access.ec2-get-password-data --force
```

**Dependencies:**
- Stratus binary must be present at the (#{stratus_path}/stratus)
- Check if ~/.aws/credentials file has a default stanza is configured

### Atomic Test 2: Search for Passwords in Powershell History

Find passwords in the powershell history files
Searching for following strings: "password", "-p", "key", "pwd", "pass"

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
ls -R C:\Users\*\AppData\Roaming\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt | Select-String "password", "-p", "key", "pwd", "pass"
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Unsecured Credentials by examining the target platforms (Windows, SaaS, IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1552 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1041 Encrypt Sensitive Information
When possible, store keys on separate cryptographic hardware instead of on the local system.

### M1051 Update Software
Apply patch KB2962486 which prevents credentials from being stored in GPPs.

### M1017 User Training
Ensure that developers and system administrators are aware of the risk associated with having plaintext passwords in software configuration files that may be left on endpoint systems or servers.

### M1015 Active Directory Configuration
Remove vulnerable Group Policy Preferences.

### M1027 Password Policies
Use strong passphrases for private keys to make cracking difficult. Do not store credentials within the Registry. Establish an organizational policy that prohibits password storage in files.

### M1028 Operating System Configuration
There are multiple methods of preventing a user's command history from being flushed to their .bash_history file, including use of the following commands:
<code>set +o history</code> and <code>set -o history</code> to start logging again;
<code>unset HISTFILE</code> being added to a user's .bash_rc file; and
<code>ln -s /dev/null ~/.bash_history</code> to write commands to <code>/dev/null</code>instead.

### M1037 Filter Network Traffic
Limit access to the Instance Metadata API. A properly configured Web Application Firewall (WAF) may help prevent external adversaries from exploiting Server-side Request Forgery (SSRF) attacks that allow access to the Cloud Instance Metadata API.

### M1022 Restrict File and Directory Permissions
Restrict file shares to specific directories with access only to necessary users.

### M1035 Limit Access to Resource Over Network
Limit network access to sensitive services, such as the Instance Metadata API.

### M1047 Audit
Preemptively search for files containing passwords or other credentials and take actions to reduce the exposure risk when found.

### M1026 Privileged Account Management
If it is necessary that software must store credentials in the Registry, then ensure the associated accounts have limited permissions so they cannot be abused if obtained by an adversary.


## Detection

### Detect Access or Search for Unsecured Credentials Across Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Unsecured Credentials technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [Brining MimiKatz to Unix](https://labs.portcullis.co.uk/download/eu-18-Wadhwa-Brown-Where-2-worlds-collide-Bringing-Mimikatz-et-al-to-UNIX.pdf)
- [Atomic Red Team - T1552](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1552)
- [MITRE ATT&CK - T1552](https://attack.mitre.org/techniques/T1552)
