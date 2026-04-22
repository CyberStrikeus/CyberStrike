---
name: "T1573.002_asymmetric-cryptography"
description: "Adversaries may employ a known asymmetric encryption algorithm to conceal command and control traffic rather than relying on any inherent protections provided by a communication protocol."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1573.002
  - command-and-control
  - esxi
  - linux
  - macos
  - network-devices
  - windows
  - sub-technique
technique_id: "T1573.002"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1573/002"
tech_stack:
  - esxi
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-300
chains_with:
  - T1573
  - T1573.001
prerequisites:
  - T1573
severity_boost:
  T1573: "Chain with T1573 for deeper attack path"
  T1573.001: "Chain with T1573.001 for deeper attack path"
---

# T1573.002 Asymmetric Cryptography

> **Sub-technique of:** T1573

## High-Level Description

Adversaries may employ a known asymmetric encryption algorithm to conceal command and control traffic rather than relying on any inherent protections provided by a communication protocol. Asymmetric cryptography, also known as public key cryptography, uses a keypair per party: one public that can be freely distributed, and one private. Due to how the keys are generated, the sender encrypts data with the receiver’s public key and the receiver decrypts the data with their private key. This ensures that only the intended recipient can read the encrypted data. Common public key encryption algorithms include RSA and ElGamal.

For efficiency, many protocols (including SSL/TLS) use symmetric cryptography once a connection is established, but use asymmetric cryptography to establish or transmit a key. As such, these protocols are classified as Asymmetric Cryptography.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Asymmetric Cryptography technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Asymmetric Cryptography
- [ ] Check Linux systems for indicators of Asymmetric Cryptography
- [ ] Check macOS systems for indicators of Asymmetric Cryptography
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Asymmetric Cryptography by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1573.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1031 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level.

### M1020 SSL/TLS Inspection
SSL/TLS inspection can be used to see the contents of encrypted sessions to look for network-based indicators of malware communication protocols.


## Detection

### Detection Strategy for Encrypted Channel via Asymmetric Cryptography across OS Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Asymmetric Cryptography technique applicable | Low | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [SANS Decrypting SSL](http://www.sans.org/reading-room/whitepapers/analyst/finding-hidden-threats-decrypting-ssl-34840)
- [SEI SSL Inspection Risks](https://insights.sei.cmu.edu/cert/2015/03/the-risks-of-ssl-inspection.html)
- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Atomic Red Team - T1573.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1573.002)
- [MITRE ATT&CK - T1573.002](https://attack.mitre.org/techniques/T1573/002)
