---
name: "T1566.003_spearphishing-via-service"
description: "Adversaries may send spearphishing messages via third-party services in an attempt to gain access to victim systems."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1566.003
  - initial-access
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1566.003"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1566/003"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-20
chains_with:
  - T1566
  - T1566.001
  - T1566.002
  - T1566.004
prerequisites:
  - T1566
severity_boost:
  T1566: "Chain with T1566 for deeper attack path"
  T1566.001: "Chain with T1566.001 for deeper attack path"
  T1566.002: "Chain with T1566.002 for deeper attack path"
---

# T1566.003 Spearphishing via Service

> **Sub-technique of:** T1566

## High-Level Description

Adversaries may send spearphishing messages via third-party services in an attempt to gain access to victim systems. Spearphishing via service is a specific variant of spearphishing. It is different from other forms of spearphishing in that it employs the use of third party services rather than directly via enterprise email channels.

All forms of spearphishing are electronically delivered social engineering targeted at a specific individual, company, or industry. In this scenario, adversaries send messages through various social media services, personal webmail, and other non-enterprise controlled services. These services are more likely to have a less-strict security policy than an enterprise. As with most kinds of spearphishing, the goal is to generate rapport with the target or get the target's interest in some way. Adversaries will create fake social media accounts and message employees for potential job opportunities. Doing so allows a plausible reason for asking about services, policies, and software that's running in an environment. The adversary can then send malicious links or attachments through these services.

A common example is to build rapport with a target via social media, then send content to a personal webmail service that the target uses on their work computer. This allows an adversary to bypass some email restrictions on the work account, and the target is more likely to open the file since it's something they were expecting. If the payload doesn't work as expected, the adversary can continue normal communications and troubleshoot with the target on how to get it working.

## Kill Chain Phase

- Initial Access (TA0001)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Spearphishing via Service technique is applicable to target environment
- [ ] Check Linux systems for indicators of Spearphishing via Service
- [ ] Check macOS systems for indicators of Spearphishing via Service
- [ ] Check Windows systems for indicators of Spearphishing via Service
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Spearphishing via Service by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1566.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1017 User Training

Users can be trained to identify social engineering techniques and spearphishing messages with malicious links.

### M1018 User Account Management

Enforce strict user account management policies on third-party service accounts to control access and limit privileges. Configure accounts with the minimum permissions necessary to perform their roles and regularly review access levels. This minimizes the risk of adversaries exploiting service accounts to execute spearphishing attacks or gain unauthorized access to sensitive resources.

### M1049 Antivirus/Antimalware

Anti-virus can also automatically quarantine suspicious files.

### M1021 Restrict Web-Based Content

Determine if certain social media sites, personal webmail services, or other service that can be used for spearphishing is necessary for business operations and consider blocking access if activity cannot be monitored well or if it poses a significant risk.

### M1047 Audit

Implement auditing and logging for interactions with third-party messaging services or collaboration platforms. Monitor user activity and review logs for signs of suspicious links, downloads, or file exchanges that could indicate spearphishing attempts. Effective auditing allows for the quick identification of malicious activity originating from compromised service accounts.

## Detection

### Detection Strategy for Spearphishing via a Service across OS Platforms

## Risk Assessment

| Finding                                        | Severity | Impact         |
| ---------------------------------------------- | -------- | -------------- |
| Spearphishing via Service technique applicable | High     | Initial Access |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [Lookout Dark Caracal Jan 2018](https://info.lookout.com/rs/051-ESQ-475/images/Lookout_Dark-Caracal_srr_20180118_us_v.1.0.pdf)
- [Atomic Red Team - T1566.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1566.003)
- [MITRE ATT&CK - T1566.003](https://attack.mitre.org/techniques/T1566/003)
