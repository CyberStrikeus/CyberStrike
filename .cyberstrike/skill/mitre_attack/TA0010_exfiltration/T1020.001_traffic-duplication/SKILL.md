---
name: "T1020.001_traffic-duplication"
description: "Adversaries may leverage traffic mirroring in order to automate data exfiltration over compromised infrastructure."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1020.001
  - exfiltration
  - network-devices
  - iaas
  - sub-technique
technique_id: "T1020.001"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - Network Devices
  - IaaS
mitre_url: "https://attack.mitre.org/techniques/T1020/001"
tech_stack:
  - network devices
  - cloud
cwe_ids:
  - CWE-200
chains_with:
  - T1020
prerequisites:
  - T1020
severity_boost:
  T1020: "Chain with T1020 for deeper attack path"
---

# T1020.001 Traffic Duplication

> **Sub-technique of:** T1020

## High-Level Description

Adversaries may leverage traffic mirroring in order to automate data exfiltration over compromised infrastructure. Traffic mirroring is a native feature for some devices, often used for network analysis. For example, devices may be configured to forward network traffic to one or more destinations for analysis by a network analyzer or other monitoring device.

Adversaries may abuse traffic mirroring to mirror or redirect network traffic through other infrastructure they control. Malicious modifications to network devices to enable traffic redirection may be possible through ROMMONkit or Patch System Image.

Many cloud-based environments also support traffic mirroring. For example, AWS Traffic Mirroring, GCP Packet Mirroring, and Azure vTap allow users to define specified instances to collect traffic from and specified targets to send collected traffic to.

Adversaries may use traffic duplication in conjunction with Network Sniffing, Input Capture, or Adversary-in-the-Middle depending on the goals and objectives of the adversary.

## Kill Chain Phase

- Exfiltration (TA0010)

**Platforms:** Network Devices, IaaS

## What to Check

- [ ] Identify if Traffic Duplication technique is applicable to target environment
- [ ] Check Network Devices systems for indicators of Traffic Duplication
- [ ] Check IaaS systems for indicators of Traffic Duplication
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Traffic Duplication by examining the target platforms (Network Devices, IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1020.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1041 Encrypt Sensitive Information

Ensure that all wired and/or wireless traffic is encrypted appropriately. Use best practices for authentication protocols, such as Kerberos, and ensure web traffic that may contain credentials is protected by SSL/TLS.

### M1018 User Account Management

In cloud environments, ensure that users are not granted permissions to create or modify traffic mirrors unless this is explicitly required.

### M1057 Data Loss Prevention

Implement Data Loss Prevention (DLP) solutions to monitor, detect, and control the flow of sensitive information. DLP tools can be configured to block unauthorized attempts to exfiltrate data, such as preventing emails from being forwarded to external recipients or monitoring for suspicious data transfers. By creating email flow rules and applying policies to detect anomalies, DLP solutions help mitigate the risk of data exfiltration over alternative protocols.

## Detection

### Detection Strategy for Traffic Duplication via Mirroring in IaaS and Network Devices

## Risk Assessment

| Finding                                  | Severity | Impact       |
| ---------------------------------------- | -------- | ------------ |
| Traffic Duplication technique applicable | Low      | Exfiltration |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [AWS Traffic Mirroring](https://docs.aws.amazon.com/vpc/latest/mirroring/traffic-mirroring-how-it-works.html)
- [Cisco Traffic Mirroring](https://www.cisco.com/c/en/us/td/docs/routers/crs/software/crs_r5-1/interfaces/configuration/guide/hc51xcrsbook/hc51span.html)
- [GCP Packet Mirroring](https://cloud.google.com/vpc/docs/packet-mirroring)
- [Juniper Traffic Mirroring](https://www.juniper.net/documentation/en_US/junos/topics/concept/port-mirroring-ex-series.html)
- [Azure Virtual Network TAP](https://docs.microsoft.com/en-us/azure/virtual-network/virtual-network-tap-overview)
- [Cisco Blog Legacy Device Attacks](https://community.cisco.com/t5/security-blogs/attackers-continue-to-target-legacy-devices/ba-p/4169954)
- [US-CERT-TA18-106A](https://www.us-cert.gov/ncas/alerts/TA18-106A)
- [Atomic Red Team - T1020.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1020.001)
- [MITRE ATT&CK - T1020.001](https://attack.mitre.org/techniques/T1020/001)
