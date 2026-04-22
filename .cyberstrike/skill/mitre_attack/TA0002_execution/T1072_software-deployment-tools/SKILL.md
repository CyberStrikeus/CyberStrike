---
name: "T1072_software-deployment-tools"
description: "Adversaries may gain access to and use centralized software suites installed within an enterprise to execute commands and move laterally through the network."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1072
  - execution
  - lateral-movement
  - linux
  - macos
  - network-devices
  - saas
  - windows
technique_id: "T1072"
tactic: "execution"
all_tactics:
  - execution
  - lateral-movement
platforms:
  - Linux
  - macOS
  - Network Devices
  - SaaS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1072"
tech_stack:
  - linux
  - macos
  - network devices
  - saas
  - windows
cwe_ids:
  - CWE-94
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1072 Software Deployment Tools

## High-Level Description

Adversaries may gain access to and use centralized software suites installed within an enterprise to execute commands and move laterally through the network. Configuration management and software deployment applications may be used in an enterprise network or cloud environment for routine administration purposes. These systems may also be integrated into CI/CD pipelines. Examples of such solutions include: SCCM, HBSS, Altiris, AWS Systems Manager, Microsoft Intune, Azure Arc, and GCP Deployment Manager. 

Access to network-wide or enterprise-wide endpoint management software may enable an adversary to achieve remote code execution on all connected systems. The access may be used to laterally move to other systems, gather information, or cause a specific effect, such as wiping the hard drives on all endpoints.

SaaS-based configuration management services may allow for broad Cloud Administration Command on cloud-hosted instances, as well as the execution of arbitrary commands on on-premises endpoints. For example, Microsoft Configuration Manager allows Global or Intune Administrators to run scripts as SYSTEM on on-premises devices joined to Entra ID. Such services may also utilize Web Protocols to communicate back to adversary owned infrastructure.

Network infrastructure devices may also have configuration management tools that can be similarly abused by adversaries.

The permissions required for this action vary by system configuration; local credentials may be sufficient with direct access to the third-party system, or specific domain credentials may be required. However, the system may require an administrative account to log in or to access specific functionality.

## Kill Chain Phase

- Execution (TA0002)
- Lateral Movement (TA0008)

**Platforms:** Linux, macOS, Network Devices, SaaS, Windows

## What to Check

- [ ] Identify if Software Deployment Tools technique is applicable to target environment
- [ ] Check Linux systems for indicators of Software Deployment Tools
- [ ] Check macOS systems for indicators of Software Deployment Tools
- [ ] Check Network Devices systems for indicators of Software Deployment Tools
- [ ] Verify mitigations are bypassed or absent (10 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Radmin Viewer Utility

An adversary may use Radmin Viewer Utility to remotely control Windows device, this will start the radmin console.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
"%PROGRAMFILES(x86)%/#{radmin_exe}"
```

**Dependencies:**
- Radmin Viewer Utility must be installed at specified location (#{radmin_exe})

### Atomic Test 2: PDQ Deploy RAT

An adversary may use PDQ Deploy Software to deploy the Remote Adminstartion Tool, this will start the PDQ console.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
"%PROGRAMFILES(x86)%/#{PDQ_Deploy_exe}"
```

**Dependencies:**
- PDQ Deploy will be installed at specified location (#{PDQ_Deploy_exe})

### Atomic Test 3: Deploy 7-Zip Using Chocolatey

An adversary may use Chocolatey to remotely deploy the 7-Zip file archiver utility.

**Supported Platforms:** windows

```powershell
# Deploy 7-Zip using Chocolatey
choco install -y 7zip
```

**Dependencies:**
- Chocolatey must be installed to deploy 7-Zip.


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Software Deployment Tools by examining the target platforms (Linux, macOS, Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1072 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1018 User Account Management
Ensure that any accounts used by third-party providers to access these systems are traceable to the third-party and are not used throughout the network or used by other third-party providers in the same environment. Ensure there are regular reviews of accounts provisioned to these systems to verify continued business need, and ensure there is governance to trace de-provisioning of access that is no longer required. Ensure proper system and access isolation for critical network systems through use of account privilege separation.

### M1015 Active Directory Configuration
Ensure proper system and access isolation for critical network systems through use of group policy.

### M1051 Update Software
Patch deployment systems regularly to prevent potential remote access through Exploitation for Privilege Escalation.

### M1026 Privileged Account Management
Grant access to application deployment systems only to a limited number of authorized administrators.

### M1027 Password Policies
Verify that account credentials that may be used to access deployment systems are unique and not used throughout the enterprise network.

### M1033 Limit Software Installation
Restrict the use of third-party software suites installed within an enterprise network.

### M1030 Network Segmentation
Ensure proper system isolation for critical network systems through use of firewalls.

### M1017 User Training
Have a strict approval policy for use of deployment systems.

### M1032 Multi-factor Authentication
Ensure proper system and access isolation for critical network systems through use of multi-factor authentication.

### M1029 Remote Data Storage
If the application deployment system can be configured to deploy only signed binaries, then ensure that the trusted signing certificates are not co-located with the application deployment system and are instead located on a system that cannot be accessed remotely or to which remote access is tightly controlled.


## Detection

### Detection of Adversary Abuse of Software Deployment Tools


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Software Deployment Tools technique applicable | High | Execution |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-94 | Improper Control of Generation of Code |


## References

- [Fortinet Zero-Day and Custom Malware Used by Suspected Chinese Actor in Espionage Operation](https://www.mandiant.com/resources/blog/fortinet-malware-ecosystem)
- [SpecterOps Lateral Movement from Azure to On-Prem AD 2020](https://posts.specterops.io/death-from-above-lateral-movement-from-azure-to-on-prem-ad-d18cb3959d4d)
- [Mitiga Security Advisory: SSM Agent as Remote Access Trojan](https://www.mitiga.io/blog/mitiga-security-advisory-abusing-the-ssm-agent-as-a-remote-access-trojan)
- [Atomic Red Team - T1072](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1072)
- [MITRE ATT&CK - T1072](https://attack.mitre.org/techniques/T1072)
