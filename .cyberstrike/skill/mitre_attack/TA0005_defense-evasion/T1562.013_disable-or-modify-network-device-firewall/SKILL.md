---
name: "T1562.013_disable-or-modify-network-device-firewall"
description: "Adversaries may disable network device-based firewall mechanisms entirely or add, delete, or modify particular rules in order to bypass controls limiting network usage."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1562.013
  - defense-evasion
  - network-devices
  - sub-technique
technique_id: "T1562.013"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1562/013"
tech_stack:
  - network devices
cwe_ids:
  - CWE-693
chains_with:
  - T1562
  - T1562.001
  - T1562.002
  - T1562.003
  - T1562.004
  - T1562.006
  - T1562.007
  - T1562.008
  - T1562.009
  - T1562.010
  - T1562.011
  - T1562.012
prerequisites:
  - T1562
severity_boost:
  T1562: "Chain with T1562 for deeper attack path"
  T1562.001: "Chain with T1562.001 for deeper attack path"
  T1562.002: "Chain with T1562.002 for deeper attack path"
---

# T1562.013 Disable or Modify Network Device Firewall

> **Sub-technique of:** T1562

## High-Level Description

Adversaries may disable network device-based firewall mechanisms entirely or add, delete, or modify particular rules in order to bypass controls limiting network usage.

Modifying or disabling a network firewall may enable adversary C2 communications, lateral movement, and/or data exfiltration that would otherwise not be allowed. For example, adversaries may add new network firewall rules to allow access to all internal network subnets without restrictions.

Adversaries may gain access to the firewall management console via Valid Accounts or by exploiting a vulnerability. In some cases, threat actors may target firewalls that have been exposed to the internet Exploit Public-Facing Application.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Network Devices

## What to Check

- [ ] Identify if Disable or Modify Network Device Firewall technique is applicable to target environment
- [ ] Check Network Devices systems for indicators of Disable or Modify Network Device Firewall
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Disable or Modify Network Device Firewall by examining the target platforms (Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1562.013 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1047 Audit

Routinely check account role permissions to ensure only expected users and roles have permission to modify system firewalls.

### M1018 User Account Management

Ensure proper user permissions are in place to prevent adversaries from disabling or modifying firewall settings.

### M1051 Update Software

Ensure the network firewall is up to date with security patches.

## Detection

### Unauthorized Network Firewall Rule Modification (T1562.013)

## Risk Assessment

| Finding                                                        | Severity | Impact          |
| -------------------------------------------------------------- | -------- | --------------- |
| Disable or Modify Network Device Firewall technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Exposed Fortinet Fortigate firewall interface leads to LockBit Ransomware](https://posts.inthecyber.com/exposed-fortinet-fortigate-firewall-interface-leads-to-lockbit-ransomware-cve-2024-55591-de8fcfb6c45c)
- [CVE-2024-55591 Detail](https://nvd.nist.gov/vuln/detail/CVE-2024-55591)
- [Atomic Red Team - T1562.013](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1562.013)
- [MITRE ATT&CK - T1562.013](https://attack.mitre.org/techniques/T1562/013)
