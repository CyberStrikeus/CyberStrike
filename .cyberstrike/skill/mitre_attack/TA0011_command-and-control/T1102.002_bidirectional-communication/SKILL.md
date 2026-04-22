---
name: "T1102.002_bidirectional-communication"
description: "Adversaries may use an existing, legitimate external Web service as a means for sending commands to and receiving output from a compromised system over the Web service channel."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1102.002
  - command-and-control
  - linux
  - macos
  - windows
  - esxi
  - sub-technique
technique_id: "T1102.002"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Linux
  - macOS
  - Windows
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1102/002"
tech_stack:
  - linux
  - macos
  - windows
  - esxi
cwe_ids:
  - CWE-300
chains_with:
  - T1102
  - T1102.001
  - T1102.003
prerequisites:
  - T1102
severity_boost:
  T1102: "Chain with T1102 for deeper attack path"
  T1102.001: "Chain with T1102.001 for deeper attack path"
  T1102.003: "Chain with T1102.003 for deeper attack path"
---

# T1102.002 Bidirectional Communication

> **Sub-technique of:** T1102

## High-Level Description

Adversaries may use an existing, legitimate external Web service as a means for sending commands to and receiving output from a compromised system over the Web service channel. Compromised systems may leverage popular websites and social media to host command and control (C2) instructions. Those infected systems can then send the output from those commands back over that Web service channel. The return traffic may occur in a variety of ways, depending on the Web service being utilized. For example, the return traffic may take the form of the compromised system posting a comment on a forum, issuing a pull request to development project, updating a document hosted on a Web service, or by sending a Tweet.

Popular websites and social media acting as a mechanism for C2 may give a significant amount of cover due to the likelihood that hosts within a network are already communicating with them prior to a compromise. Using common services, such as those offered by Google or Twitter, makes it easier for adversaries to hide in expected noise. Web service providers commonly use SSL/TLS encryption, giving adversaries an added level of protection.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** Linux, macOS, Windows, ESXi

## What to Check

- [ ] Identify if Bidirectional Communication technique is applicable to target environment
- [ ] Check Linux systems for indicators of Bidirectional Communication
- [ ] Check macOS systems for indicators of Bidirectional Communication
- [ ] Check Windows systems for indicators of Bidirectional Communication
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Bidirectional Communication by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1102.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1021 Restrict Web-Based Content

Web proxies can be used to enforce external network communication policy that prevents use of unauthorized external services.

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level.

## Detection

### Detect Bidirectional Web Service C2 Channels via Process & Network Correlation

## Risk Assessment

| Finding                                          | Severity | Impact              |
| ------------------------------------------------ | -------- | ------------------- |
| Bidirectional Communication technique applicable | Low      | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Atomic Red Team - T1102.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1102.002)
- [MITRE ATT&CK - T1102.002](https://attack.mitre.org/techniques/T1102/002)
