---
name: "T1588.002_tool"
description: "Adversaries may buy, steal, or download software tools that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1588.002
  - resource-development
  - pre
  - sub-technique
technique_id: "T1588.002"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1588/002"
tech_stack:
  - pre
cwe_ids: []
chains_with:
  - T1588
  - T1588.001
  - T1588.003
  - T1588.004
  - T1588.005
  - T1588.006
  - T1588.007
prerequisites:
  - T1588
severity_boost:
  T1588: "Chain with T1588 for deeper attack path"
  T1588.001: "Chain with T1588.001 for deeper attack path"
  T1588.003: "Chain with T1588.003 for deeper attack path"
---

# T1588.002 Tool

> **Sub-technique of:** T1588

## High-Level Description

Adversaries may buy, steal, or download software tools that can be used during targeting. Tools can be open or closed source, free or commercial. A tool can be used for malicious purposes by an adversary, but (unlike malware) were not intended to be used for those purposes (ex: PsExec).

Adversaries may obtain tools to support their operations, including to support execution of post-compromise behaviors. Tools may also be leveraged for testing – for example, evaluating malware against commercial antivirus or endpoint detection and response (EDR) applications.

Tool acquisition may involve the procurement of commercial software licenses, including for red teaming tools such as Cobalt Strike. In addition to freely downloading or purchasing software, adversaries may steal software and/or software licenses from third-party entities (including other adversaries). Threat actors may also crack trial versions of software.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Tool technique is applicable to target environment
- [ ] Check PRE systems for indicators of Tool
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Tool by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1588.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.

## Detection

### Detection of Tool

## Risk Assessment

| Finding                   | Severity | Impact               |
| ------------------------- | -------- | -------------------- |
| Tool technique applicable | Low      | Resource Development |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [Sentinel Labs Top Tier Target 2025](https://www.sentinelone.com/labs/top-tier-target-what-it-takes-to-defend-a-cybersecurity-company-from-todays-adversaries/)
- [Analyzing CS Dec 2020](https://www.randhome.io/blog/2020/12/20/analyzing-cobalt-strike-for-fun-and-profit/)
- [Recorded Future Beacon 2019](https://www.recordedfuture.com/blog/identifying-cobalt-strike-servers)
- [Forescout Conti Leaks 2022](https://www.forescout.com/resources/analysis-of-conti-leaks/)
- [Atomic Red Team - T1588.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1588.002)
- [MITRE ATT&CK - T1588.002](https://attack.mitre.org/techniques/T1588/002)
