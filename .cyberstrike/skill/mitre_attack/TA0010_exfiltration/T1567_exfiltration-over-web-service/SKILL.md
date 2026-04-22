---
name: "T1567_exfiltration-over-web-service"
description: "Adversaries may use an existing, legitimate external Web service to exfiltrate data rather than their primary command and control channel."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1567
  - exfiltration
  - esxi
  - linux
  - macos
  - office-suite
  - saas
  - windows
technique_id: "T1567"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - ESXi
  - Linux
  - macOS
  - Office Suite
  - SaaS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1567"
tech_stack:
  - esxi
  - linux
  - macos
  - office
  - saas
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1567.001
  - T1567.002
  - T1567.003
  - T1567.004
prerequisites: []
severity_boost:
  T1567.001: "Chain with T1567.001 for deeper attack path"
  T1567.002: "Chain with T1567.002 for deeper attack path"
  T1567.003: "Chain with T1567.003 for deeper attack path"
---

# T1567 Exfiltration Over Web Service

## High-Level Description

Adversaries may use an existing, legitimate external Web service to exfiltrate data rather than their primary command and control channel. Popular Web services acting as an exfiltration mechanism may give a significant amount of cover due to the likelihood that hosts within a network are already communicating with them prior to compromise. Firewall rules may also already exist to permit traffic to these services.

Web service providers also commonly use SSL/TLS encryption, giving adversaries an added level of protection.

## Kill Chain Phase

- Exfiltration (TA0010)

**Platforms:** ESXi, Linux, macOS, Office Suite, SaaS, Windows

## What to Check

- [ ] Identify if Exfiltration Over Web Service technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Exfiltration Over Web Service
- [ ] Check Linux systems for indicators of Exfiltration Over Web Service
- [ ] Check macOS systems for indicators of Exfiltration Over Web Service
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Exfiltration Over Web Service by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1567 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1021 Restrict Web-Based Content

Web proxies can be used to enforce an external network communication policy that prevents use of unauthorized external services.

### M1057 Data Loss Prevention

Data loss prevention can be detect and block sensitive data being uploaded to web services via web browsers.

## Detection

### Detection Strategy for Exfiltration Over Web Service

## Risk Assessment

| Finding                                            | Severity | Impact       |
| -------------------------------------------------- | -------- | ------------ |
| Exfiltration Over Web Service technique applicable | Low      | Exfiltration |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Atomic Red Team - T1567](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1567)
- [MITRE ATT&CK - T1567](https://attack.mitre.org/techniques/T1567)
