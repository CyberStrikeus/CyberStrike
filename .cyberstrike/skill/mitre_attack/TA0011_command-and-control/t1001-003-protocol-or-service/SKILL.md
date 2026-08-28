---
name: "T1001.003_protocol-or-service-impersonation"
description: "Adversaries may impersonate legitimate protocols or web service traffic to disguise command and control activity and thwart analysis efforts."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1001.003
  - command-and-control
  - esxi
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1001.003"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1001/003"
tech_stack:
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-300
chains_with:
  - T1001
  - T1001.001
  - T1001.002
prerequisites:
  - T1001
severity_boost:
  T1001: "Chain with T1001 for deeper attack path"
  T1001.001: "Chain with T1001.001 for deeper attack path"
  T1001.002: "Chain with T1001.002 for deeper attack path"
---

# T1001.003 Protocol or Service Impersonation

> **Sub-technique of:** T1001

## High-Level Description

Adversaries may impersonate legitimate protocols or web service traffic to disguise command and control activity and thwart analysis efforts. By impersonating legitimate protocols or web services, adversaries can make their command and control traffic blend in with legitimate network traffic.

Adversaries may impersonate a fake SSL/TLS handshake to make it look like subsequent traffic is SSL/TLS encrypted, potentially interfering with some security tooling, or to make the traffic look like it is related with a trusted entity.

Adversaries may also leverage legitimate protocols to impersonate expected web traffic or trusted services. For example, adversaries may manipulate HTTP headers, URI endpoints, SSL certificates, and transmitted data to disguise C2 communications or mimic legitimate services such as Gmail, Google Drive, and Yahoo Messenger.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Protocol or Service Impersonation technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Protocol or Service Impersonation
- [ ] Check Linux systems for indicators of Protocol or Service Impersonation
- [ ] Check macOS systems for indicators of Protocol or Service Impersonation
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Protocol or Service Impersonation by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1001.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate some obfuscation activity at the network level.

## Detection

### Detecting Protocol or Service Impersonation via Anomalous TLS, HTTP Header, and Port Mismatch Correlation

## Risk Assessment

| Finding                                                | Severity | Impact              |
| ------------------------------------------------------ | -------- | ------------------- |
| Protocol or Service Impersonation technique applicable | Low      | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [Malleable-C2-U42](https://unit42.paloaltonetworks.com/cobalt-strike-malleable-c2-profile/)
- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [ESET Okrum July 2019](https://www.welivesecurity.com/wp-content/uploads/2019/07/ESET_Okrum_and_Ketrican.pdf)
- [Atomic Red Team - T1001.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1001.003)
- [MITRE ATT&CK - T1001.003](https://attack.mitre.org/techniques/T1001/003)
