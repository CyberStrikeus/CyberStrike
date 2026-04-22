---
name: "T0885_commonly-used-port"
description: "Adversaries may communicate over a commonly used port to bypass firewalls or network detection systems and to blend in with normal network activity, to avoid more detailed inspection."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0885
  - command-and-control
technique_id: "T0885"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0885"
tech_stack:
  - ics
cwe_ids:
  - CWE-300
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0885 Commonly Used Port

## High-Level Description

Adversaries may communicate over a commonly used port to bypass firewalls or network detection systems and to blend in with normal network activity, to avoid more detailed inspection. They may use the protocol associated with the port, or a completely different protocol. They may use commonly open ports, such as the examples provided below. 
 
 * TCP:80 (HTTP) 
 * TCP:443 (HTTPS) 
 * TCP/UDP:53 (DNS) 
 * TCP:1024-4999 (OPC on XP/Win2k3) 
 * TCP:49152-65535 (OPC on Vista and later) 
 * TCP:23 (TELNET) 
 * UDP:161 (SNMP) 
 * TCP:502 (MODBUS) 
 * TCP:102 (S7comm/ISO-TSAP) 
 * TCP:20000 (DNP3) 
 * TCP:44818 (Ethernet/IP)

## Kill Chain Phase

- Command and Control (TA0101)

**Platforms:** ICS

## What to Check

- [ ] Identify if Commonly Used Port technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Commonly Used Port
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Commonly Used Port by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0885 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0804 Human User Authentication
All field controllers should require users to authenticate for all remote or local management sessions. The authentication mechanisms should also support Account Use Policies, Password Policies, and User Account Management.

### M0931 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level. Signatures are often for unique indicators within protocols and may be based on the specific protocol used by a particular adversary or tool and will likely be different across various malware families and versions. Adversaries will likely change tool C2 signatures over time or construct protocols in such a way as to avoid detection by common defensive tools.

### M0930 Network Segmentation
Configure internal and external firewalls to block traffic using common ports that associate to network protocols that may be unnecessary for that particular network segment.

### M0942 Disable or Remove Feature or Program
Ensure that unnecessary ports and services are closed to prevent risk of discovery and potential exploitation.


## Detection

### Detection of Commonly Used Port


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Commonly Used Port technique applicable | Low | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [MITRE ATT&CK ICS - T0885](https://attack.mitre.org/techniques/T0885)
