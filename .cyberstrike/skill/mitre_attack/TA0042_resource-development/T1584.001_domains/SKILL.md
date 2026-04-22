---
name: "T1584.001_domains"
description: "Adversaries may hijack domains and/or subdomains that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1584.001
  - resource-development
  - pre
  - sub-technique
technique_id: "T1584.001"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1584/001"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1584
  - T1584.002
  - T1584.003
  - T1584.004
  - T1584.005
  - T1584.006
  - T1584.007
  - T1584.008
prerequisites:
  - T1584
severity_boost:
  T1584: "Chain with T1584 for deeper attack path"
  T1584.002: "Chain with T1584.002 for deeper attack path"
  T1584.003: "Chain with T1584.003 for deeper attack path"
---

# T1584.001 Domains

> **Sub-technique of:** T1584

## High-Level Description

Adversaries may hijack domains and/or subdomains that can be used during targeting. Domain registration hijacking is the act of changing the registration of a domain name without the permission of the original registrant. Adversaries may gain access to an email account for the person listed as the owner of the domain. The adversary can then claim that they forgot their password in order to make changes to the domain registration. Other possibilities include social engineering a domain registration help desk to gain access to an account, taking advantage of renewal process gaps, or compromising a cloud service that enables managing domains (e.g., AWS Route53).

Subdomain hijacking can occur when organizations have DNS entries that point to non-existent or deprovisioned resources. In such cases, an adversary may take control of a subdomain to conduct operations with the benefit of the trust associated with that domain.

Adversaries who compromise a domain may also engage in domain shadowing by creating malicious subdomains under their control while keeping any existing DNS records. As service will not be disrupted, the malicious subdomains may go unnoticed for long periods of time.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Domains technique is applicable to target environment
- [ ] Check PRE systems for indicators of Domains
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Domains by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1584.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Domains


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Domains technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [Krebs DNS Hijack 2019](https://krebsonsecurity.com/2019/02/a-deep-dive-on-the-recent-widespread-dns-hijacking-attacks/)
- [ICANNDomainNameHijacking](https://www.icann.org/en/ssac/registration-services/documents/sac-007-domain-name-hijacking-incidents-threats-risks-and-remediation-12-07-2005-en)
- [Palo Alto Unit 42 Domain Shadowing 2022](https://unit42.paloaltonetworks.com/domain-shadowing/)
- [Microsoft Sub Takeover 2020](https://docs.microsoft.com/en-us/azure/security/fundamentals/subdomain-takeover)
- [Atomic Red Team - T1584.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1584.001)
- [MITRE ATT&CK - T1584.001](https://attack.mitre.org/techniques/T1584/001)
