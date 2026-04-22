---
name: "T1568.002_domain-generation-algorithms"
description: "Adversaries may make use of Domain Generation Algorithms (DGAs) to dynamically identify a destination domain for command and control traffic rather than relying on a list of static IP addresses or ..."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1568.002
  - command-and-control
  - linux
  - macos
  - windows
  - esxi
  - sub-technique
technique_id: "T1568.002"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Linux
  - macOS
  - Windows
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1568/002"
tech_stack:
  - linux
  - macos
  - windows
  - esxi
cwe_ids:
  - CWE-300
chains_with:
  - T1568
  - T1568.001
  - T1568.003
prerequisites:
  - T1568
severity_boost:
  T1568: "Chain with T1568 for deeper attack path"
  T1568.001: "Chain with T1568.001 for deeper attack path"
  T1568.003: "Chain with T1568.003 for deeper attack path"
---

# T1568.002 Domain Generation Algorithms

> **Sub-technique of:** T1568

## High-Level Description

Adversaries may make use of Domain Generation Algorithms (DGAs) to dynamically identify a destination domain for command and control traffic rather than relying on a list of static IP addresses or domains. This has the advantage of making it much harder for defenders to block, track, or take over the command and control channel, as there potentially could be thousands of domains that malware can check for instructions.

DGAs can take the form of apparently random or “gibberish” strings (ex: istgmxdejdnxuyla.ru) when they construct domain names by generating each letter. Alternatively, some DGAs employ whole words as the unit by concatenating words together instead of letters (ex: cityjulydish.net). Many DGAs are time-based, generating a different domain for each time period (hourly, daily, monthly, etc). Others incorporate a seed value as well to make predicting future domains more difficult for defenders.

Adversaries may use DGAs for the purpose of Fallback Channels. When contact is lost with the primary command and control server malware may employ a DGA as a means to reestablishing command and control.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** Linux, macOS, Windows, ESXi

## What to Check

- [ ] Identify if Domain Generation Algorithms technique is applicable to target environment
- [ ] Check Linux systems for indicators of Domain Generation Algorithms
- [ ] Check macOS systems for indicators of Domain Generation Algorithms
- [ ] Check Windows systems for indicators of Domain Generation Algorithms
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Domain Generation Algorithms by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1568.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level. Malware researchers can reverse engineer malware variants that use DGAs and determine future domains that the malware will attempt to contact, but this is a time and resource intensive effort. Malware is also increasingly incorporating seed values that can be unique for each instance, which would then need to be determined to extract future generated domains. In some cases, the seed that a particular sample uses can be extracted from DNS traffic. Even so, there can be thousands of possible domains generated per day; this makes it impractical for defenders to preemptively register all possible C2 domains due to the cost.

### M1021 Restrict Web-Based Content

In some cases a local DNS sinkhole may be used to help prevent DGA-based command and control at a reduced cost.

## Detection

### Detection Strategy for Dynamic Resolution using Domain Generation Algorithms.

## Risk Assessment

| Finding                                           | Severity | Impact              |
| ------------------------------------------------- | -------- | ------------------- |
| Domain Generation Algorithms technique applicable | Low      | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [Elastic Predicting DGA](https://arxiv.org/pdf/1611.00791.pdf)
- [Talos CCleanup 2017](http://blog.talosintelligence.com/2017/09/avast-distributes-malware.html)
- [Pace University Detecting DGA May 2017](http://csis.pace.edu/~ctappert/srd2017/2017PDF/d4.pdf)
- [FireEye POSHSPY April 2017](https://www.fireeye.com/blog/threat-research/2017/03/dissecting_one_ofap.html)
- [ESET Sednit 2017 Activity](https://www.welivesecurity.com/2017/12/21/sednit-update-fancy-bear-spent-year/)
- [Data Driven Security DGA](https://datadrivensecurity.info/blog/posts/2014/Oct/dga-part2/)
- [Akamai DGA Mitigation](https://medium.com/@yvyuz/a-death-match-of-domain-generation-algorithms-a5b5dbdc1c6e)
- [Cisco Umbrella DGA](https://umbrella.cisco.com/blog/2016/10/10/domain-generation-algorithms-effective/)
- [Cybereason Dissecting DGAs](http://go.cybereason.com/rs/996-YZT-709/images/Cybereason-Lab-Analysis-Dissecting-DGAs-Eight-Real-World-DGA-Variants.pdf)
- [Unit 42 DGA Feb 2019](https://unit42.paloaltonetworks.com/threat-brief-understanding-domain-generation-algorithms-dga/)
- [Atomic Red Team - T1568.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1568.002)
- [MITRE ATT&CK - T1568.002](https://attack.mitre.org/techniques/T1568/002)
