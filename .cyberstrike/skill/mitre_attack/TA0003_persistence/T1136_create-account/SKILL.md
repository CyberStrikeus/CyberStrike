---
name: "T1136_create-account"
description: "Adversaries may create an account to maintain access to victim systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1136
  - persistence
  - windows
  - iaas
  - linux
  - macos
  - network-devices
  - containers
  - saas
  - office-suite
  - identity-provider
  - esxi
technique_id: "T1136"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Windows
  - IaaS
  - Linux
  - macOS
  - Network Devices
  - Containers
  - SaaS
  - Office Suite
  - Identity Provider
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1136"
tech_stack:
  - windows
  - cloud
  - linux
  - macos
  - network devices
  - containers
  - saas
  - office
  - identity
  - esxi
cwe_ids:
  - CWE-276
chains_with:
  - T1136.001
  - T1136.002
  - T1136.003
prerequisites: []
severity_boost:
  T1136.001: "Chain with T1136.001 for deeper attack path"
  T1136.002: "Chain with T1136.002 for deeper attack path"
  T1136.003: "Chain with T1136.003 for deeper attack path"
---

# T1136 Create Account

## High-Level Description

Adversaries may create an account to maintain access to victim systems. With a sufficient level of access, creating such accounts may be used to establish secondary credentialed access that do not require persistent remote access tools to be deployed on the system.

Accounts may be created on the local system or within a domain or cloud tenant. In cloud environments, adversaries may create accounts that only have access to specific services, which can reduce the chance of detection.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Windows, IaaS, Linux, macOS, Network Devices, Containers, SaaS, Office Suite, Identity Provider, ESXi

## What to Check

- [ ] Identify if Create Account technique is applicable to target environment
- [ ] Check Windows systems for indicators of Create Account
- [ ] Check IaaS systems for indicators of Create Account
- [ ] Check Linux systems for indicators of Create Account
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Create Account by examining the target platforms (Windows, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1136 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1030 Network Segmentation

Configure access controls and firewalls to limit access to domain controllers and systems used to create and manage accounts.

### M1028 Operating System Configuration

Protect domain controllers by ensuring proper security configuration for critical servers.

### M1032 Multi-factor Authentication

Use multi-factor authentication for user and privileged accounts.

### M1026 Privileged Account Management

Limit the number of accounts with permissions to create other accounts. Do not allow domain administrator accounts to be used for day-to-day operations that may expose them to potential adversaries on unprivileged systems.

## Detection

### Detection Strategy for T1136 - Create Account across platforms

## Risk Assessment

| Finding                             | Severity | Impact      |
| ----------------------------------- | -------- | ----------- |
| Create Account technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Microsoft User Creation Event](https://docs.microsoft.com/en-us/windows/security/threat-protection/auditing/event-4720)
- [Symantec WastedLocker June 2020](https://symantec-enterprise-blogs.security.com/blogs/threat-intelligence/wastedlocker-ransomware-us)
- [Atomic Red Team - T1136](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1136)
- [MITRE ATT&CK - T1136](https://attack.mitre.org/techniques/T1136)
