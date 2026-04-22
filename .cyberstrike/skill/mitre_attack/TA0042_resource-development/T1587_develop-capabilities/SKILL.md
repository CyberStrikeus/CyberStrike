---
name: "T1587_develop-capabilities"
description: "Adversaries may build capabilities that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1587
  - resource-development
  - pre
technique_id: "T1587"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1587"
tech_stack:
  - pre
cwe_ids: []
chains_with:
  - T1587.001
  - T1587.002
  - T1587.003
  - T1587.004
prerequisites: []
severity_boost:
  T1587.001: "Chain with T1587.001 for deeper attack path"
  T1587.002: "Chain with T1587.002 for deeper attack path"
  T1587.003: "Chain with T1587.003 for deeper attack path"
---

# T1587 Develop Capabilities

## High-Level Description

Adversaries may build capabilities that can be used during targeting. Rather than purchasing, freely downloading, or stealing capabilities, adversaries may develop their own capabilities in-house. This is the process of identifying development requirements and building solutions such as malware, exploits, and self-signed certificates. Adversaries may develop capabilities to support their operations throughout numerous phases of the adversary lifecycle.

As with legitimate development efforts, different skill sets may be required for developing capabilities. The skills needed may be located in-house, or may need to be contracted out. Use of a contractor may be considered an extension of that adversary's development capabilities, provided the adversary plays a role in shaping requirements and maintains a degree of exclusivity to the capability.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Develop Capabilities technique is applicable to target environment
- [ ] Check PRE systems for indicators of Develop Capabilities
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Develop Capabilities by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1587 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.

## Detection

### Detection of Develop Capabilities

## Risk Assessment

| Finding                                   | Severity | Impact               |
| ----------------------------------------- | -------- | -------------------- |
| Develop Capabilities technique applicable | High     | Resource Development |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [Kaspersky Sofacy](https://securelist.com/sofacy-apt-hits-high-profile-targets-with-updated-toolset/72924/)
- [Splunk Kovar Certificates 2017](https://www.splunk.com/en_us/blog/security/tall-tales-of-hunting-with-tls-ssl-certificates.html)
- [Mandiant APT1](https://www.fireeye.com/content/dam/fireeye-www/services/pdfs/mandiant-apt1-report.pdf)
- [Talos Promethium June 2020](https://blog.talosintelligence.com/2020/06/promethium-extends-with-strongpity3.html)
- [Bitdefender StrongPity June 2020](https://www.bitdefender.com/files/News/CaseStudies/study/353/Bitdefender-Whitepaper-StrongPity-APT.pdf)
- [Atomic Red Team - T1587](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1587)
- [MITRE ATT&CK - T1587](https://attack.mitre.org/techniques/T1587)
