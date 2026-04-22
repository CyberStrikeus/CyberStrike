---
name: "T1608.002_upload-tool"
description: "Adversaries may upload tools to third-party or adversary controlled infrastructure to make it accessible during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1608.002
  - resource-development
  - pre
  - sub-technique
technique_id: "T1608.002"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1608/002"
tech_stack:
  - pre
cwe_ids: []
chains_with:
  - T1608
  - T1608.001
  - T1608.003
  - T1608.004
  - T1608.005
  - T1608.006
prerequisites:
  - T1608
severity_boost:
  T1608: "Chain with T1608 for deeper attack path"
  T1608.001: "Chain with T1608.001 for deeper attack path"
  T1608.003: "Chain with T1608.003 for deeper attack path"
---

# T1608.002 Upload Tool

> **Sub-technique of:** T1608

## High-Level Description

Adversaries may upload tools to third-party or adversary controlled infrastructure to make it accessible during targeting. Tools can be open or closed source, free or commercial. Tools can be used for malicious purposes by an adversary, but (unlike malware) were not intended to be used for those purposes (ex: PsExec). Adversaries may upload tools to support their operations, such as making a tool available to a victim network to enable Ingress Tool Transfer by placing it on an Internet accessible web server.

Tools may be placed on infrastructure that was previously purchased/rented by the adversary (Acquire Infrastructure) or was otherwise compromised by them (Compromise Infrastructure). Tools can also be staged on web services, such as an adversary controlled GitHub repo, or on Platform-as-a-Service offerings that enable users to easily provision applications.

Adversaries can avoid the need to upload a tool by having compromised victim machines download the tool directly from a third-party hosting location (ex: a non-adversary controlled GitHub repo), including the original hosting site of the tool.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Upload Tool technique is applicable to target environment
- [ ] Check PRE systems for indicators of Upload Tool
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Upload Tool by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1608.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.

## Detection

### Detection of Upload Tool

## Risk Assessment

| Finding                          | Severity | Impact               |
| -------------------------------- | -------- | -------------------- |
| Upload Tool technique applicable | High     | Resource Development |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [Dell TG-3390](https://www.secureworks.com/research/threat-group-3390-targets-organizations-for-cyberespionage)
- [Malwarebytes Heroku Skimmers](https://www.malwarebytes.com/blog/news/2019/12/theres-an-app-for-that-web-skimmers-found-on-paas-heroku)
- [Dragos Heroku Watering Hole](https://www.dragos.com/blog/industry-news/a-new-water-watering-hole/)
- [Intezer App Service Phishing](https://www.intezer.com/blog/malware-analysis/kud-i-enter-your-server-new-vulnerabilities-in-microsoft-azure/)
- [Atomic Red Team - T1608.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1608.002)
- [MITRE ATT&CK - T1608.002](https://attack.mitre.org/techniques/T1608/002)
