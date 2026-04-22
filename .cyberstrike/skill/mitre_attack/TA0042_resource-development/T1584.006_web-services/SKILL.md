---
name: "T1584.006_web-services"
description: "Adversaries may compromise access to third-party web services that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1584.006
  - resource-development
  - pre
  - sub-technique
technique_id: "T1584.006"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1584/006"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1584
  - T1584.001
  - T1584.002
  - T1584.003
  - T1584.004
  - T1584.005
  - T1584.007
  - T1584.008
prerequisites:
  - T1584
severity_boost:
  T1584: "Chain with T1584 for deeper attack path"
  T1584.001: "Chain with T1584.001 for deeper attack path"
  T1584.002: "Chain with T1584.002 for deeper attack path"
---

# T1584.006 Web Services

> **Sub-technique of:** T1584

## High-Level Description

Adversaries may compromise access to third-party web services that can be used during targeting. A variety of popular websites exist for legitimate users to register for web-based services, such as GitHub, Twitter, Dropbox, Google, SendGrid, etc. Adversaries may try to take ownership of a legitimate user's access to a web service and use that web service as infrastructure in support of cyber operations. Such web services can be abused during later stages of the adversary lifecycle, such as during Command and Control (Web Service), Exfiltration Over Web Service, or Phishing. Using common services, such as those offered by Google or Twitter, makes it easier for adversaries to hide in expected noise. By utilizing a web service, particularly when access is stolen from legitimate users, adversaries can make it difficult to physically tie back operations to them. Additionally, leveraging compromised web-based email services may allow adversaries to leverage the trust associated with legitimate domains.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Web Services technique is applicable to target environment
- [ ] Check PRE systems for indicators of Web Services
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Web Services by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1584.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Web Services


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Web Services technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [Recorded Future Turla Infra 2020](https://www.recordedfuture.com/research/turla-apt-infrastructure)
- [ThreatConnect Infrastructure Dec 2020](https://threatconnect.com/blog/infrastructure-research-hunting/)
- [Atomic Red Team - T1584.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1584.006)
- [MITRE ATT&CK - T1584.006](https://attack.mitre.org/techniques/T1584/006)
