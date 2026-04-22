---
name: "T1557.003_dhcp-spoofing"
description: "Adversaries may redirect network traffic to adversary-owned systems by spoofing Dynamic Host Configuration Protocol (DHCP) traffic and acting as a malicious DHCP server on the victim network."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1557.003
  - credential-access
  - collection
  - linux
  - windows
  - macos
  - sub-technique
technique_id: "T1557.003"
tactic: "credential-access"
all_tactics:
  - credential-access
  - collection
platforms:
  - Linux
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1557/003"
tech_stack:
  - linux
  - windows
  - macos
cwe_ids:
  - CWE-522
chains_with:
  - T1557
  - T1557.001
  - T1557.002
  - T1557.004
prerequisites:
  - T1557
severity_boost:
  T1557: "Chain with T1557 for deeper attack path"
  T1557.001: "Chain with T1557.001 for deeper attack path"
  T1557.002: "Chain with T1557.002 for deeper attack path"
---

# T1557.003 DHCP Spoofing

> **Sub-technique of:** T1557

## High-Level Description

Adversaries may redirect network traffic to adversary-owned systems by spoofing Dynamic Host Configuration Protocol (DHCP) traffic and acting as a malicious DHCP server on the victim network. By achieving the adversary-in-the-middle (AiTM) position, adversaries may collect network communications, including passed credentials, especially those sent over insecure, unencrypted protocols. This may also enable follow-on behaviors such as Network Sniffing or Transmitted Data Manipulation.

DHCP is based on a client-server model and has two functionalities: a protocol for providing network configuration settings from a DHCP server to a client and a mechanism for allocating network addresses to clients. The typical server-client interaction is as follows: 

1. The client broadcasts a `DISCOVER` message.

2. The server responds with an `OFFER` message, which includes an available network address. 

3. The client broadcasts a `REQUEST` message, which includes the network address offered. 

4. The server acknowledges with an `ACK` message and the client receives the network configuration parameters.

Adversaries may spoof as a rogue DHCP server on the victim network, from which legitimate hosts may receive malicious network configurations. For example, malware can act as a DHCP server and provide adversary-owned DNS servers to the victimized computers. Through the malicious network configurations, an adversary may achieve the AiTM position, route client traffic through adversary-controlled systems, and collect information from the client network.

DHCPv6 clients can receive network configuration information without being assigned an IP address by sending a <code>INFORMATION-REQUEST (code 11)</code> message to the <code>All_DHCP_Relay_Agents_and_Servers</code> multicast address. Adversaries may use their rogue DHCP server to respond to this request message with malicious network configurations.

Rather than establishing an AiTM position, adversaries may also abuse DHCP spoofing to perform a DHCP exhaustion attack (i.e, Service Exhaustion Flood) by generating many broadcast DISCOVER messages to exhaust a network’s DHCP allocation pool.

## Kill Chain Phase

- Credential Access (TA0006)
- Collection (TA0009)

**Platforms:** Linux, Windows, macOS

## What to Check

- [ ] Identify if DHCP Spoofing technique is applicable to target environment
- [ ] Check Linux systems for indicators of DHCP Spoofing
- [ ] Check Windows systems for indicators of DHCP Spoofing
- [ ] Check macOS systems for indicators of DHCP Spoofing
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to DHCP Spoofing by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1557.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1037 Filter Network Traffic
Consider filtering DHCP traffic on ports 67 and 68 to/from unknown or untrusted DHCP servers. Additionally, port security may also be enabled on layer switches. Furthermore, consider enabling DHCP snooping on layer 2 switches as it will prevent DHCP spoofing attacks and starvation attacks. Consider tracking available IP addresses through a script or a tool. 

Additionally, block DHCPv6 traffic and incoming router advertisements, especially if IPv6 is not commonly used in the network.

### M1031 Network Intrusion Prevention
Network intrusion detection and prevention systems that can identify traffic patterns indicative of AiTM activity can be used to mitigate activity at the network level.


## Detection

### Detect DHCP Spoofing Across Linux, Windows, and macOS


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| DHCP Spoofing technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [rfc2131](https://datatracker.ietf.org/doc/html/rfc2131)
- [new_rogue_DHCP_serv_malware](https://isc.sans.edu/forums/diary/new+rogueDHCP+server+malware/6025/)
- [rfc3315](https://datatracker.ietf.org/doc/html/rfc3315)
- [dhcp_serv_op_events](https://docs.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2012-R2-and-2012/dn800668(v=ws.11))
- [solution_monitor_dhcp_scopes](https://web.archive.org/web/20231202025258/https://lockstepgroup.com/blog/monitor-dhcp-scopes-and-detect-man-in-the-middle-attacks/)
- [w32.tidserv.g](https://web.archive.org/web/20150923175837/http://www.symantec.com/security_response/writeup.jsp?docid=2009-032211-2952-99&tabid=2)
- [Atomic Red Team - T1557.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1557.003)
- [MITRE ATT&CK - T1557.003](https://attack.mitre.org/techniques/T1557/003)
