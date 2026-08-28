---
name: "T1499.004_application-or-system-exploitation"
description: "Adversaries may exploit software vulnerabilities that can cause an application or system to crash and deny availability to users."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1499.004
  - impact
  - windows
  - iaas
  - linux
  - macos
  - sub-technique
technique_id: "T1499.004"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Windows
  - IaaS
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1499/004"
tech_stack:
  - windows
  - cloud
  - linux
  - macos
cwe_ids:
  - CWE-400
chains_with:
  - T1499
  - T1499.001
  - T1499.002
  - T1499.003
prerequisites:
  - T1499
severity_boost:
  T1499: "Chain with T1499 for deeper attack path"
  T1499.001: "Chain with T1499.001 for deeper attack path"
  T1499.002: "Chain with T1499.002 for deeper attack path"
---

# T1499.004 Application or System Exploitation

> **Sub-technique of:** T1499

## High-Level Description

Adversaries may exploit software vulnerabilities that can cause an application or system to crash and deny availability to users. Some systems may automatically restart critical applications and services when crashes occur, but they can likely be re-exploited to cause a persistent denial of service (DoS) condition.

Adversaries may exploit known or zero-day vulnerabilities to crash applications and/or systems, which may also lead to dependent applications and/or systems to be in a DoS condition. Crashed or restarted applications or systems may also have other effects such as Data Destruction, Firmware Corruption, Service Stop etc. which may further cause a DoS condition and deny availability to critical information, applications and/or systems.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Windows, IaaS, Linux, macOS

## What to Check

- [ ] Identify if Application or System Exploitation technique is applicable to target environment
- [ ] Check Windows systems for indicators of Application or System Exploitation
- [ ] Check IaaS systems for indicators of Application or System Exploitation
- [ ] Check Linux systems for indicators of Application or System Exploitation
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Application or System Exploitation by examining the target platforms (Windows, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1499.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1037 Filter Network Traffic

Leverage services provided by Content Delivery Networks (CDN) or providers specializing in DoS mitigations to filter traffic upstream from services. Filter boundary traffic by blocking source addresses sourcing the attack, blocking ports that are being targeted, or blocking protocols being used for transport.

## Detection

### Detection Strategy for Endpoint DoS via Application or System Exploitation

## Risk Assessment

| Finding                                                 | Severity | Impact |
| ------------------------------------------------------- | -------- | ------ |
| Application or System Exploitation technique applicable | High     | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [Sucuri BIND9 August 2015](https://blog.sucuri.net/2015/08/bind9-denial-of-service-exploit-in-the-wild.html)
- [Atomic Red Team - T1499.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1499.004)
- [MITRE ATT&CK - T1499.004](https://attack.mitre.org/techniques/T1499/004)
