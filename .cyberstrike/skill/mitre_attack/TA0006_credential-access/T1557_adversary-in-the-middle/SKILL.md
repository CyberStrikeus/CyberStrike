---
name: "T1557_adversary-in-the-middle"
description: "Adversaries may attempt to position themselves between two or more networked devices using an adversary-in-the-middle (AiTM) technique to support follow-on behaviors such as Network Sniffing, Trans..."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1557
  - credential-access
  - collection
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1557"
tactic: "credential-access"
all_tactics:
  - credential-access
  - collection
platforms:
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1557"
tech_stack:
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1557.001
  - T1557.002
  - T1557.003
  - T1557.004
prerequisites: []
severity_boost:
  T1557.001: "Chain with T1557.001 for deeper attack path"
  T1557.002: "Chain with T1557.002 for deeper attack path"
  T1557.003: "Chain with T1557.003 for deeper attack path"
---

# T1557 Adversary-in-the-Middle

## High-Level Description

Adversaries may attempt to position themselves between two or more networked devices using an adversary-in-the-middle (AiTM) technique to support follow-on behaviors such as Network Sniffing, Transmitted Data Manipulation, or replay attacks (Exploitation for Credential Access). By abusing features of common networking protocols that can determine the flow of network traffic (e.g. ARP, DNS, LLMNR, etc.), adversaries may force a device to communicate through an adversary controlled system so they can collect information or perform additional actions.

For example, adversaries may manipulate victim DNS settings to enable other malicious activities such as preventing/redirecting users from accessing legitimate sites and/or pushing additional malware. Adversaries may also manipulate DNS and leverage their position in order to intercept user credentials, including access tokens (Steal Application Access Token) and session cookies (Steal Web Session Cookie). Downgrade Attacks can also be used to establish an AiTM position, such as by negotiating a less secure, deprecated, or weaker version of communication protocol (SSL/TLS) or encryption algorithm.

Adversaries may also leverage the AiTM position to attempt to monitor and/or modify traffic, such as in Transmitted Data Manipulation. Adversaries can setup a position similar to AiTM to prevent traffic from flowing to the appropriate destination, potentially to Impair Defenses and/or in support of a Network Denial of Service.

## Kill Chain Phase

- Credential Access (TA0006)
- Collection (TA0009)

**Platforms:** Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Adversary-in-the-Middle technique is applicable to target environment
- [ ] Check Linux systems for indicators of Adversary-in-the-Middle
- [ ] Check macOS systems for indicators of Adversary-in-the-Middle
- [ ] Check Network Devices systems for indicators of Adversary-in-the-Middle
- [ ] Verify mitigations are bypassed or absent (7 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Adversary-in-the-Middle by examining the target platforms (Linux, macOS, Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1557 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1037 Filter Network Traffic

Use network appliances and host-based security software to block network traffic that is not necessary within the environment, such as legacy protocols that may be leveraged for AiTM conditions.

### M1041 Encrypt Sensitive Information

Ensure that all wired and/or wireless traffic is encrypted appropriately. Use best practices for authentication protocols, such as Kerberos, and ensure web traffic that may contain credentials is protected by SSL/TLS.

### M1035 Limit Access to Resource Over Network

Limit access to network infrastructure and resources that can be used to reshape traffic or otherwise produce AiTM conditions.

### M1042 Disable or Remove Feature or Program

Disable legacy network protocols that may be used to intercept network traffic if applicable, especially those that are not needed within an environment.

### M1017 User Training

Train users to be suspicious about certificate errors. Adversaries may use their own certificates in an attempt to intercept HTTPS traffic. Certificate errors may arise when the application’s certificate does not match the one expected by the host.

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that can identify traffic patterns indicative of AiTM activity can be used to mitigate activity at the network level.

### M1030 Network Segmentation

Network segmentation can be used to isolate infrastructure components that do not require broad network access. This may mitigate, or at least alleviate, the scope of AiTM activity.

## Detection

### Detect Adversary-in-the-Middle via Network and Configuration Anomalies

## Risk Assessment

| Finding                                      | Severity | Impact            |
| -------------------------------------------- | -------- | ----------------- |
| Adversary-in-the-Middle technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [dns_changer_trojans](https://www.trendmicro.com/vinfo/us/threat-encyclopedia/web-attack/125/how-dns-changer-trojans-direct-users-to-threats)
- [volexity_0day_sophos_FW](https://www.volexity.com/blog/2022/06/15/driftingcloud-zero-day-sophos-firewall-exploitation-and-an-insidious-breach/)
- [taxonomy_downgrade_att_tls](https://arxiv.org/abs/1809.05681)
- [ad_blocker_with_miner](https://securelist.com/ad-blocker-with-miner-included/101105/)
- [Token tactics](https://www.microsoft.com/en-us/security/blog/2022/11/16/token-tactics-how-to-prevent-detect-and-respond-to-cloud-token-theft/)
- [mitm_tls_downgrade_att](https://www.praetorian.com/blog/man-in-the-middle-tls-ssl-protocol-downgrade-attack/)
- [Rapid7 MiTM Basics](https://www.rapid7.com/fundamentals/man-in-the-middle-attacks/)
- [tlseminar_downgrade_att](https://tlseminar.github.io/downgrade-attacks/)
- [ttint_rat](https://blog.netlab.360.com/ttint-an-iot-remote-control-trojan-spread-through-2-0-day-vulnerabilities/)
- [Atomic Red Team - T1557](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1557)
- [MITRE ATT&CK - T1557](https://attack.mitre.org/techniques/T1557)
