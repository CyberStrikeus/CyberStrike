---
name: "T1650_acquire-access"
description: "Adversaries may purchase or otherwise acquire an existing access to a target system or network."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1650
  - resource-development
  - pre
technique_id: "T1650"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1650"
tech_stack:
  - pre
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1650 Acquire Access

## High-Level Description

Adversaries may purchase or otherwise acquire an existing access to a target system or network. A variety of online services and initial access broker networks are available to sell access to previously compromised systems. In some cases, adversary groups may form partnerships to share compromised systems with each other.

Footholds to compromised systems may take a variety of forms, such as access to planted backdoors (e.g., Web Shell) or established access via External Remote Services. In some cases, access brokers will implant compromised systems with a “load” that can be used to install additional malware for paying customers.

By leveraging existing access broker networks rather than developing or obtaining their own initial access capabilities, an adversary can potentially reduce the resources required to gain a foothold on a target network and focus their efforts on later stages of compromise. Adversaries may prioritize acquiring access to systems that have been determined to lack security monitoring or that have high privileges, or systems that belong to organizations in a particular sector.

In some cases, purchasing access to an organization in sectors such as IT contracting, software development, or telecommunications may allow an adversary to compromise additional victims via a Trusted Relationship, Multi-Factor Authentication Interception, or even Supply Chain Compromise.

**Note:** while this technique is distinct from other behaviors such as Purchase Technical Data and Credentials, they may often be used in conjunction (especially where the acquired foothold requires Valid Accounts).

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Acquire Access technique is applicable to target environment
- [ ] Check PRE systems for indicators of Acquire Access
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Acquire Access by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1650 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.

## Detection

### Detection of Acquire Access

## Risk Assessment

| Finding                             | Severity | Impact               |
| ----------------------------------- | -------- | -------------------- |
| Acquire Access technique applicable | High     | Resource Development |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [Krebs Access Brokers Fortune 500](https://krebsonsecurity.com/2012/10/service-sells-access-to-fortune-500-firms/)
- [CrowdStrike Access Brokers](https://www.crowdstrike.com/blog/access-brokers-targets-and-worth/)
- [CISA Karakurt 2022](https://www.cisa.gov/news-events/cybersecurity-advisories/aa22-152a)
- [Microsoft Ransomware as a Service](https://www.microsoft.com/en-us/security/blog/2022/05/09/ransomware-as-a-service-understanding-the-cybercrime-gig-economy-and-how-to-protect-yourself/)
- [Atomic Red Team - T1650](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1650)
- [MITRE ATT&CK - T1650](https://attack.mitre.org/techniques/T1650)
