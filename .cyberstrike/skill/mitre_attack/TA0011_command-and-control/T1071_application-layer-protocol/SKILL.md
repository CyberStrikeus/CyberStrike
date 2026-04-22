---
name: "T1071_application-layer-protocol"
description: "Adversaries may communicate using OSI application layer protocols to avoid detection/network filtering by blending in with existing traffic."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1071
  - command-and-control
  - linux
  - macos
  - windows
  - network-devices
  - esxi
technique_id: "T1071"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Linux
  - macOS
  - Windows
  - Network Devices
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1071"
tech_stack:
  - linux
  - macos
  - windows
  - network devices
  - esxi
cwe_ids:
  - CWE-300
chains_with:
  - T1071.001
  - T1071.002
  - T1071.003
  - T1071.004
  - T1071.005
prerequisites:
  []
severity_boost:
  T1071.001: "Chain with T1071.001 for deeper attack path"
  T1071.002: "Chain with T1071.002 for deeper attack path"
  T1071.003: "Chain with T1071.003 for deeper attack path"
---

# T1071 Application Layer Protocol

## High-Level Description

Adversaries may communicate using OSI application layer protocols to avoid detection/network filtering by blending in with existing traffic. Commands to the remote system, and often the results of those commands, will be embedded within the protocol traffic between the client and server. 

Adversaries may utilize many different protocols, including those used for web browsing, transferring files, electronic mail, DNS, or publishing/subscribing. For connections that occur internally within an enclave (such as those between a proxy or pivot node and other nodes), commonly used protocols are SMB, SSH, or RDP.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** Linux, macOS, Windows, Network Devices, ESXi

## What to Check

- [ ] Identify if Application Layer Protocol technique is applicable to target environment
- [ ] Check Linux systems for indicators of Application Layer Protocol
- [ ] Check macOS systems for indicators of Application Layer Protocol
- [ ] Check Windows systems for indicators of Application Layer Protocol
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Telnet C2

An adversary may establish Telnet communication from a compromised endpoint to a command and control (C2) server in order to carry out additional attacks on objectives.

**Supported Platforms:** windows

```powershell
#{client_path} #{server_ip} --port #{server_port}
```

**Dependencies:**
- A command and control (C2) server can be established by running PathToAtomicsFolder\T1071\bin\telnet_server.exe on a specified server with a specified IP that must be reachable by a client (telnet_client.exe)


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Application Layer Protocol by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1071 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1031 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level.

### M1037 Filter Network Traffic
Use network appliances to filter ingress or egress traffic and perform protocol-based filtering. Configure software on endpoints to filter network traffic.


## Detection

### Detection of Command and Control Over Application Layer Protocols


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Application Layer Protocol technique applicable | Medium | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Mandiant APT29 Eye Spy Email Nov 22](https://www.mandiant.com/resources/blog/unc3524-eye-spy-email)
- [Atomic Red Team - T1071](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1071)
- [MITRE ATT&CK - T1071](https://attack.mitre.org/techniques/T1071)
