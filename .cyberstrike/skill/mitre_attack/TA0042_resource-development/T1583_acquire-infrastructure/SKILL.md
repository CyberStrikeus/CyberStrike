---
name: "T1583_acquire-infrastructure"
description: "Adversaries may buy, lease, rent, or obtain infrastructure that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1583
  - resource-development
  - pre
technique_id: "T1583"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1583"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1583.001
  - T1583.002
  - T1583.003
  - T1583.004
  - T1583.005
  - T1583.006
  - T1583.007
  - T1583.008
prerequisites:
  []
severity_boost:
  T1583.001: "Chain with T1583.001 for deeper attack path"
  T1583.002: "Chain with T1583.002 for deeper attack path"
  T1583.003: "Chain with T1583.003 for deeper attack path"
---

# T1583 Acquire Infrastructure

## High-Level Description

Adversaries may buy, lease, rent, or obtain infrastructure that can be used during targeting. A wide variety of infrastructure exists for hosting and orchestrating adversary operations. Infrastructure solutions include physical or cloud servers, domains, and third-party web services. Some infrastructure providers offer free trial periods, enabling infrastructure acquisition at limited to no cost. Additionally, botnets are available for rent or purchase.

Use of these infrastructure solutions allows adversaries to stage, launch, and execute operations. Solutions may help adversary operations blend in with traffic that is seen as normal, such as contacting third-party web services or acquiring infrastructure to support Proxy, including from residential proxy services. Depending on the implementation, adversaries may use infrastructure that makes it difficult to physically tie back to them as well as utilize infrastructure that can be rapidly provisioned, modified, and shut down.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Acquire Infrastructure technique is applicable to target environment
- [ ] Check PRE systems for indicators of Acquire Infrastructure
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Acquire Infrastructure by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1583 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Acquire Infrastructure


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Acquire Infrastructure technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [amnesty_nso_pegasus](https://www.amnesty.org/en/latest/research/2021/07/forensic-methodology-report-how-to-catch-nso-groups-pegasus/)
- [Mandiant APT29 Microsoft 365 2022](https://www.mandiant.com/resources/blog/apt29-continues-targeting-microsoft)
- [FBI Proxies Credential Stuffing](https://www.ic3.gov/Media/News/2022/220818.pdf)
- [Free Trial PurpleUrchin](https://unit42.paloaltonetworks.com/purpleurchin-steals-cloud-resources/)
- [Koczwara Beacon Hunting Sep 2021](https://michaelkoczwara.medium.com/cobalt-strike-c2-hunting-with-shodan-c448d501a6e2)
- [TrendmicroHideoutsLease](https://documents.trendmicro.com/assets/wp/wp-criminal-hideouts-for-lease.pdf)
- [Mandiant SCANdalous Jul 2020](https://cloud.google.com/blog/topics/threat-intelligence/scandalous-external-detection-using-network-scan-data-and-automation/)
- [ThreatConnect Infrastructure Dec 2020](https://threatconnect.com/blog/infrastructure-research-hunting/)
- [Atomic Red Team - T1583](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1583)
- [MITRE ATT&CK - T1583](https://attack.mitre.org/techniques/T1583)
