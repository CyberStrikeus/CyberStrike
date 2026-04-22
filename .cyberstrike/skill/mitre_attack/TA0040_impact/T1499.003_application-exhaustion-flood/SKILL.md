---
name: "T1499.003_application-exhaustion-flood"
description: "Adversaries may target resource intensive features of applications to cause a denial of service (DoS), denying availability to those applications."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1499.003
  - impact
  - windows
  - iaas
  - linux
  - macos
  - sub-technique
technique_id: "T1499.003"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Windows
  - IaaS
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1499/003"
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
  - T1499.004
prerequisites:
  - T1499
severity_boost:
  T1499: "Chain with T1499 for deeper attack path"
  T1499.001: "Chain with T1499.001 for deeper attack path"
  T1499.002: "Chain with T1499.002 for deeper attack path"
---

# T1499.003 Application Exhaustion Flood

> **Sub-technique of:** T1499

## High-Level Description

Adversaries may target resource intensive features of applications to cause a denial of service (DoS), denying availability to those applications. For example, specific features in web applications may be highly resource intensive. Repeated requests to those features may be able to exhaust system resources and deny access to the application or the server itself.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Windows, IaaS, Linux, macOS

## What to Check

- [ ] Identify if Application Exhaustion Flood technique is applicable to target environment
- [ ] Check Windows systems for indicators of Application Exhaustion Flood
- [ ] Check IaaS systems for indicators of Application Exhaustion Flood
- [ ] Check Linux systems for indicators of Application Exhaustion Flood
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Application Exhaustion Flood by examining the target platforms (Windows, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1499.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1037 Filter Network Traffic

Leverage services provided by Content Delivery Networks (CDN) or providers specializing in DoS mitigations to filter traffic upstream from services. Filter boundary traffic by blocking source addresses sourcing the attack, blocking ports that are being targeted, or blocking protocols being used for transport.

## Detection

### Application Exhaustion Flood Detection Across Platforms

## Risk Assessment

| Finding                                           | Severity | Impact |
| ------------------------------------------------- | -------- | ------ |
| Application Exhaustion Flood technique applicable | Low      | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [Cisco DoSdetectNetflow](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/netflow/configuration/15-mt/nf-15-mt-book/nf-detct-analy-thrts.pdf)
- [Arbor AnnualDoSreport Jan 2018](https://pages.arbornetworks.com/rs/082-KNA-087/images/13th_Worldwide_Infrastructure_Security_Report.pdf)
- [Atomic Red Team - T1499.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1499.003)
- [MITRE ATT&CK - T1499.003](https://attack.mitre.org/techniques/T1499/003)
