---
name: "T1491.002_external-defacement"
description: "An adversary may deface systems external to an organization in an attempt to deliver messaging, intimidate, or otherwise mislead an organization or users."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1491.002
  - impact
  - windows
  - iaas
  - linux
  - macos
  - sub-technique
technique_id: "T1491.002"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Windows
  - IaaS
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1491/002"
tech_stack:
  - windows
  - cloud
  - linux
  - macos
cwe_ids:
  - CWE-400
chains_with:
  - T1491
  - T1491.001
prerequisites:
  - T1491
severity_boost:
  T1491: "Chain with T1491 for deeper attack path"
  T1491.001: "Chain with T1491.001 for deeper attack path"
---

# T1491.002 External Defacement

> **Sub-technique of:** T1491

## High-Level Description

An adversary may deface systems external to an organization in an attempt to deliver messaging, intimidate, or otherwise mislead an organization or users. External Defacement may ultimately cause users to distrust the systems and to question/discredit the system’s integrity. Externally-facing websites are a common victim of defacement; often targeted by adversary and hacktivist groups in order to push a political message or spread propaganda. External Defacement may be used as a catalyst to trigger events, or as a response to actions taken by an organization or government. Similarly, website defacement may also be used as setup, or a precursor, for future attacks such as Drive-by Compromise.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Windows, IaaS, Linux, macOS

## What to Check

- [ ] Identify if External Defacement technique is applicable to target environment
- [ ] Check Windows systems for indicators of External Defacement
- [ ] Check IaaS systems for indicators of External Defacement
- [ ] Check Linux systems for indicators of External Defacement
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to External Defacement by examining the target platforms (Windows, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1491.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1053 Data Backup

Consider implementing IT disaster recovery plans that contain procedures for taking regular data backups that can be used to restore organizational data. Ensure backups are stored off system and is protected from common methods adversaries may use to gain access and destroy the backups to prevent recovery.

## Detection

### Behavioral Detection of External Website Defacement across Platforms

## Risk Assessment

| Finding                                  | Severity | Impact |
| ---------------------------------------- | -------- | ------ |
| External Defacement technique applicable | Low      | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [Anonymous Hackers Deface Russian Govt Site](https://torrentfreak.com/anonymous-hackers-deface-russian-govt-site-to-protest-web-blocking-nsfw-180512/)
- [FireEye Cyber Threats to Media Industries](https://web.archive.org/web/20210719110553/https://www.fireeye.com/content/dam/fireeye-www/current-threats/pdfs/ib-entertainment.pdf)
- [Kevin Mandia Statement to US Senate Committee on Intelligence](https://www.intelligence.senate.gov/sites/default/files/documents/os-kmandia-033017.pdf)
- [Trend Micro Deep Dive Into Defacement](https://documents.trendmicro.com/assets/white_papers/wp-a-deep-dive-into-defacement.pdf)
- [Atomic Red Team - T1491.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1491.002)
- [MITRE ATT&CK - T1491.002](https://attack.mitre.org/techniques/T1491/002)
