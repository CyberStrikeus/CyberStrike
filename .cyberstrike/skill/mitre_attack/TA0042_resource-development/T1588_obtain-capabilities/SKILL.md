---
name: "T1588_obtain-capabilities"
description: "Adversaries may buy and/or steal capabilities that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1588
  - resource-development
  - pre
technique_id: "T1588"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1588"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1588.001
  - T1588.002
  - T1588.003
  - T1588.004
  - T1588.005
  - T1588.006
  - T1588.007
prerequisites:
  []
severity_boost:
  T1588.001: "Chain with T1588.001 for deeper attack path"
  T1588.002: "Chain with T1588.002 for deeper attack path"
  T1588.003: "Chain with T1588.003 for deeper attack path"
---

# T1588 Obtain Capabilities

## High-Level Description

Adversaries may buy and/or steal capabilities that can be used during targeting. Rather than developing their own capabilities in-house, adversaries may purchase, freely download, or steal them. Activities may include the acquisition of malware, software (including licenses), exploits, certificates, and information relating to vulnerabilities. Adversaries may obtain capabilities to support their operations throughout numerous phases of the adversary lifecycle.

In addition to downloading free malware, software, and exploits from the internet, adversaries may purchase these capabilities from third-party entities. Third-party entities can include technology companies that specialize in malware and exploits, criminal marketplaces, or from individuals.

In addition to purchasing capabilities, adversaries may steal capabilities from third-party entities (including other adversaries). This can include stealing software licenses, malware, SSL/TLS and code-signing certificates, or raiding closed databases of vulnerabilities or exploits.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Obtain Capabilities technique is applicable to target environment
- [ ] Check PRE systems for indicators of Obtain Capabilities
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Obtain Capabilities by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1588 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Obtain Capabilities


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Obtain Capabilities technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [PegasusCitizenLab](https://citizenlab.ca/2016/08/million-dollar-dissident-iphone-zero-day-nso-group-uae/)
- [FireEyeSupplyChain](https://www.mandiant.com/resources/supply-chain-analysis-from-quartermaster-to-sunshop)
- [DiginotarCompromise](https://threatpost.com/final-report-diginotar-hack-shows-total-compromise-ca-servers-103112/77170/)
- [Recorded Future Beacon Certificates](https://www.recordedfuture.com/research/cobalt-strike-servers)
- [Splunk Kovar Certificates 2017](https://www.splunk.com/en_us/blog/security/tall-tales-of-hunting-with-tls-ssl-certificates.html)
- [Analyzing CS Dec 2020](https://www.randhome.io/blog/2020/12/20/analyzing-cobalt-strike-for-fun-and-profit/)
- [NationsBuying](https://www.nytimes.com/2013/07/14/world/europe/nations-buying-as-hackers-sell-computer-flaws.html)
- [Atomic Red Team - T1588](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1588)
- [MITRE ATT&CK - T1588](https://attack.mitre.org/techniques/T1588)
