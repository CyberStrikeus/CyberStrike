---
name: "T1021_remote-services"
description: "Adversaries may use Valid Accounts to log into a service that accepts remote connections, such as telnet, SSH, and VNC."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1021
  - lateral-movement
  - linux
  - macos
  - windows
  - iaas
  - esxi
technique_id: "T1021"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
platforms:
  - Linux
  - macOS
  - Windows
  - IaaS
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1021"
tech_stack:
  - linux
  - macos
  - windows
  - cloud
  - esxi
cwe_ids:
  - CWE-284
chains_with:
  - T1021.001
  - T1021.002
  - T1021.003
  - T1021.004
  - T1021.005
  - T1021.006
  - T1021.007
  - T1021.008
prerequisites: []
severity_boost:
  T1021.001: "Chain with T1021.001 for deeper attack path"
  T1021.002: "Chain with T1021.002 for deeper attack path"
  T1021.003: "Chain with T1021.003 for deeper attack path"
---

# T1021 Remote Services

## High-Level Description

Adversaries may use Valid Accounts to log into a service that accepts remote connections, such as telnet, SSH, and VNC. The adversary may then perform actions as the logged-on user.

In an enterprise environment, servers and workstations can be organized into domains. Domains provide centralized identity management, allowing users to login using one set of credentials across the entire network. If an adversary is able to obtain a set of valid domain credentials, they could login to many different machines using remote access protocols such as secure shell (SSH) or remote desktop protocol (RDP). They could also login to accessible SaaS or IaaS services, such as those that federate their identities to the domain, or management platforms for internal virtualization environments such as VMware vCenter.

Legitimate applications (such as Software Deployment Tools and other administrative programs) may utilize Remote Services to access remote hosts. For example, Apple Remote Desktop (ARD) on macOS is native software used for remote management. ARD leverages a blend of protocols, including VNC to send the screen and control buffers and SSH for secure file transfer. Adversaries can abuse applications such as ARD to gain remote code execution and perform lateral movement. In versions of macOS prior to 10.14, an adversary can escalate an SSH session to an ARD session which enables an adversary to accept TCC (Transparency, Consent, and Control) prompts without user interaction and gain access to data.

## Kill Chain Phase

- Lateral Movement (TA0008)

**Platforms:** Linux, macOS, Windows, IaaS, ESXi

## What to Check

- [ ] Identify if Remote Services technique is applicable to target environment
- [ ] Check Linux systems for indicators of Remote Services
- [ ] Check macOS systems for indicators of Remote Services
- [ ] Check Windows systems for indicators of Remote Services
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Remote Services by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1021 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1035 Limit Access to Resource Over Network

Prevent unnecessary remote access to file shares, hypervisors, sensitive systems, etc. Mechanisms to limit access may include use of network concentrators, RDP gateways, etc.

### M1047 Audit

Perform audits or scans of systems, permissions, insecure software, insecure configurations, etc. to identify potential weaknesses.

### M1018 User Account Management

Limit the accounts that may use remote services. Limit the permissions for accounts that are at higher risk of compromise; for example, configure SSH so users can only run specific programs.

### M1042 Disable or Remove Feature or Program

If remote services, such as the ability to make direct connections to cloud virtual machines, are not required, disable these connection types where feasible. On ESXi servers, consider enabling lockdown mode, which disables direct access to an ESXi host and requires that the host be managed remotely using vCenter.

### M1032 Multi-factor Authentication

Use multi-factor authentication on remote service logons where possible.

### M1027 Password Policies

Do not reuse local administrator account passwords across systems. Ensure password complexity and uniqueness such that the passwords cannot be cracked or guessed.

## Detection

### Behavioral Detection Strategy for Remote Service Logins and Post-Access Activity

## Risk Assessment

| Finding                              | Severity | Impact           |
| ------------------------------------ | -------- | ---------------- |
| Remote Services technique applicable | High     | Lateral Movement |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [Apple Remote Desktop Admin Guide 3.3](https://images.apple.com/remotedesktop/pdf/ARD_Admin_Guide_v3.3.pdf)
- [Remote Management MDM macOS](https://support.apple.com/en-us/HT209161)
- [Kickstart Apple Remote Desktop commands](https://support.apple.com/en-us/HT201710)
- [Lockboxx ARD 2019](http://lockboxx.blogspot.com/2019/07/macos-red-teaming-206-ard-apple-remote.html)
- [FireEye 2019 Apple Remote Desktop](https://www.fireeye.com/blog/threat-research/2019/10/leveraging-apple-remote-desktop-for-good-and-evil.html)
- [TechNet Remote Desktop Services](https://technet.microsoft.com/en-us/windowsserver/ee236407.aspx)
- [Apple Unified Log Analysis Remote Login and Screen Sharing](https://sarah-edwards-xzkc.squarespace.com/blog/2020/4/30/analysis-of-apple-unified-logs-quarantine-edition-entry-6-working-from-home-remote-logins)
- [SSH Secure Shell](https://www.ssh.com/ssh)
- [Atomic Red Team - T1021](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1021)
- [MITRE ATT&CK - T1021](https://attack.mitre.org/techniques/T1021)
