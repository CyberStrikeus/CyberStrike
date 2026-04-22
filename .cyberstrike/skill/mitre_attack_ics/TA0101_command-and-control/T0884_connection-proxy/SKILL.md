---
name: "T0884_connection-proxy"
description: "Adversaries may use a connection proxy to direct network traffic between systems or act as an intermediary for network communications."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0884
  - command-and-control
technique_id: "T0884"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0884"
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

# T0884 Connection Proxy

## High-Level Description

Adversaries may use a connection proxy to direct network traffic between systems or act as an intermediary for network communications.

The definition of a proxy can also be expanded to encompass trust relationships between networks in peer-to-peer, mesh, or trusted connections between networks consisting of hosts or systems that regularly communicate with each other.

The network may be within a single organization or across multiple organizations with trust relationships. Adversaries could use these types of relationships to manage command and control communications, to reduce the number of simultaneous outbound network connections, to provide resiliency in the face of connection loss, or to ride over existing trusted communications paths between victims to avoid suspicion.

## Kill Chain Phase

- Command and Control (TA0101)

**Platforms:** ICS

## What to Check

- [ ] Identify if Connection Proxy technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Connection Proxy
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Connection Proxy by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0884 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0920 SSL/TLS Inspection
If it is possible to inspect HTTPS traffic, the captures can be analyzed for connections that appear to be domain fronting.

### M0931 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level. Signatures are often for unique indicators within protocols and may be based on the specific C2 protocol used by a particular adversary or tool and will likely be different across various malware families and versions. Adversaries will likely change tool C2 signatures over time or construct protocols in such a way as to avoid detection by common defensive tools.

### M0937 Filter Network Traffic
Traffic to known anonymity networks and C2 infrastructure can be blocked through the use of network allow and block lists. It should be noted that this kind of blocking may be circumvented by other techniques likeDomain Fronting.

### M0807 Network Allowlists
Network allowlists can be implemented through either host-based files or system host files to specify what external connections (e.g., IP address, MAC address, port, protocol) can be made from a device. Allowlist techniques that operate at the application layer (e.g., DNP3, Modbus, HTTP) are addressed in the Filter Network Traffic mitigation.


## Detection

### Detection of Connection Proxy


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Connection Proxy technique applicable | Medium | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [Enterprise ATT&CK January 2018](https://attack.mitre.org/wiki/Technique/T1090)
- [MITRE ATT&CK ICS - T0884](https://attack.mitre.org/techniques/T0884)
