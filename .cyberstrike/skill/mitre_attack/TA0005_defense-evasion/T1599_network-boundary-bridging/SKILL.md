---
name: "T1599_network-boundary-bridging"
description: "Adversaries may bridge network boundaries by compromising perimeter network devices or internal devices responsible for network segmentation."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1599
  - defense-evasion
  - network-devices
technique_id: "T1599"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1599"
tech_stack:
  - network devices
cwe_ids:
  - CWE-693
chains_with:
  - T1599.001
prerequisites:
  []
severity_boost:
  T1599.001: "Chain with T1599.001 for deeper attack path"
---

# T1599 Network Boundary Bridging

## High-Level Description

Adversaries may bridge network boundaries by compromising perimeter network devices or internal devices responsible for network segmentation. Breaching these devices may enable an adversary to bypass restrictions on traffic routing that otherwise separate trusted and untrusted networks.

Devices such as routers and firewalls can be used to create boundaries between trusted and untrusted networks. They achieve this by restricting traffic types to enforce organizational policy in an attempt to reduce the risk inherent in such connections. Restriction of traffic can be achieved by prohibiting IP addresses, layer 4 protocol ports, or through deep packet inspection to identify applications. To participate with the rest of the network, these devices can be directly addressable or transparent, but their mode of operation has no bearing on how the adversary can bypass them when compromised.

When an adversary takes control of such a boundary device, they can bypass its policy enforcement to pass normally prohibited traffic across the trust boundary between the two separated networks without hinderance. By achieving sufficient rights on the device, an adversary can reconfigure the device to allow the traffic they want, allowing them to then further achieve goals such as command and control via Multi-hop Proxy or exfiltration of data via Traffic Duplication. Adversaries may also target internal devices responsible for network segmentation and abuse these in conjunction with Internal Proxy to achieve the same goals. In the cases where a border device separates two separate organizations, the adversary can also facilitate lateral movement into new victim environments.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Network Devices

## What to Check

- [ ] Identify if Network Boundary Bridging technique is applicable to target environment
- [ ] Check Network Devices systems for indicators of Network Boundary Bridging
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Network Boundary Bridging by examining the target platforms (Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1599 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1032 Multi-factor Authentication
Use multi-factor authentication for user and privileged accounts. Most embedded network devices support TACACS+ and/or RADIUS. Follow vendor prescribed best practices for hardening access control.

### M1027 Password Policies
Refer to NIST guidelines when creating password policies.

### M1026 Privileged Account Management
Restrict administrator accounts to as few individuals as possible, following least privilege principles. Prevent credential overlap across systems of administrator and privileged accounts, particularly between network and non-network platforms, such as servers or endpoints.

### M1037 Filter Network Traffic
Upon identifying a compromised network device being used to bridge a network boundary, block the malicious packets using an unaffected network device in path, such as a firewall or a router that has not been compromised. Continue to monitor for additional activity and to ensure that the blocks are indeed effective.

### M1043 Credential Access Protection
Some embedded network devices are capable of storing passwords for local accounts in either plain-text or encrypted formats. Ensure that, where available, local passwords are always encrypted, per vendor recommendations.


## Detection

### Detection Strategy for Network Boundary Bridging


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Network Boundary Bridging technique applicable | Medium | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Kaspersky ThreatNeedle Feb 2021](https://securelist.com/lazarus-threatneedle/100803/)
- [Atomic Red Team - T1599](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1599)
- [MITRE ATT&CK - T1599](https://attack.mitre.org/techniques/T1599)
