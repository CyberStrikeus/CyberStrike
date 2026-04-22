---
name: "T1557.004_evil-twin"
description: "Adversaries may host seemingly genuine Wi-Fi access points to deceive users into connecting to malicious networks as a way of supporting follow-on behaviors such as Network Sniffing, Transmitted Da..."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1557.004
  - credential-access
  - collection
  - network-devices
  - sub-technique
technique_id: "T1557.004"
tactic: "credential-access"
all_tactics:
  - credential-access
  - collection
platforms:
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1557/004"
tech_stack:
  - network devices
cwe_ids:
  - CWE-522
chains_with:
  - T1557
  - T1557.001
  - T1557.002
  - T1557.003
prerequisites:
  - T1557
severity_boost:
  T1557: "Chain with T1557 for deeper attack path"
  T1557.001: "Chain with T1557.001 for deeper attack path"
  T1557.002: "Chain with T1557.002 for deeper attack path"
---

# T1557.004 Evil Twin

> **Sub-technique of:** T1557

## High-Level Description

Adversaries may host seemingly genuine Wi-Fi access points to deceive users into connecting to malicious networks as a way of supporting follow-on behaviors such as Network Sniffing, Transmitted Data Manipulation, or Input Capture.

By using a Service Set Identifier (SSID) of a legitimate Wi-Fi network, fraudulent Wi-Fi access points may trick devices or users into connecting to malicious Wi-Fi networks. Adversaries may provide a stronger signal strength or block access to Wi-Fi access points to coerce or entice victim devices into connecting to malicious networks. A Wi-Fi Pineapple – a network security auditing and penetration testing tool – may be deployed in Evil Twin attacks for ease of use and broader range. Custom certificates may be used in an attempt to intercept HTTPS traffic.

Similarly, adversaries may also listen for client devices sending probe requests for known or previously connected networks (Preferred Network Lists or PNLs). When a malicious access point receives a probe request, adversaries can respond with the same SSID to imitate the trusted, known network. Victim devices are led to believe the responding access point is from their PNL and initiate a connection to the fraudulent network.

Upon logging into the malicious Wi-Fi access point, a user may be directed to a fake login page or captive portal webpage to capture the victim’s credentials. Once a user is logged into the fraudulent Wi-Fi network, the adversary may able to monitor network activity, manipulate data, or steal additional credentials. Locations with high concentrations of public Wi-Fi access, such as airports, coffee shops, or libraries, may be targets for adversaries to set up illegitimate Wi-Fi access points.

## Kill Chain Phase

- Credential Access (TA0006)
- Collection (TA0009)

**Platforms:** Network Devices

## What to Check

- [ ] Identify if Evil Twin technique is applicable to target environment
- [ ] Check Network Devices systems for indicators of Evil Twin
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Evil Twin by examining the target platforms (Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1557.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1031 Network Intrusion Prevention

Wireless intrusion prevention systems (WIPS) can identify traffic patterns indicative of adversary-in-the-middle activity and scan for evils twins and rogue access points.

### M1017 User Training

Train users to be suspicious about access points marked as “Open” or “Unsecure” as well as certificate errors. Certificate errors may arise when the application’s certificate does not match the one expected by the host.

## Detection

### Detect Evil Twin Wi-Fi Access Points on Network Devices

## Risk Assessment

| Finding                        | Severity | Impact            |
| ------------------------------ | -------- | ----------------- |
| Evil Twin technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Kaspersky evil twin](https://usa.kaspersky.com/resource-center/preemptive-safety/evil-twin-attacks)
- [medium evil twin](https://kavigihan.medium.com/wireless-security-evil-twin-attack-d3842f4aef59)
- [specter ops evil twin](https://posts.specterops.io/modern-wireless-attacks-pt-i-basic-rogue-ap-theory-evil-twin-and-karma-attacks-35a8571550ee)
- [Australia ‘Evil Twin’](https://www.bleepingcomputer.com/news/security/australian-charged-for-evil-twin-wifi-attack-on-plane/)
- [Atomic Red Team - T1557.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1557.004)
- [MITRE ATT&CK - T1557.004](https://attack.mitre.org/techniques/T1557/004)
