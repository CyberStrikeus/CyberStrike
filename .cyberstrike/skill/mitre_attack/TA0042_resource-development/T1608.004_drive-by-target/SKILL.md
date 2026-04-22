---
name: "T1608.004_drive-by-target"
description: "Adversaries may prepare an operational environment to infect systems that visit a website over the normal course of browsing."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1608.004
  - resource-development
  - pre
  - sub-technique
technique_id: "T1608.004"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1608/004"
tech_stack:
  - pre
cwe_ids: []
chains_with:
  - T1608
  - T1608.001
  - T1608.002
  - T1608.003
  - T1608.005
  - T1608.006
prerequisites:
  - T1608
severity_boost:
  T1608: "Chain with T1608 for deeper attack path"
  T1608.001: "Chain with T1608.001 for deeper attack path"
  T1608.002: "Chain with T1608.002 for deeper attack path"
---

# T1608.004 Drive-by Target

> **Sub-technique of:** T1608

## High-Level Description

Adversaries may prepare an operational environment to infect systems that visit a website over the normal course of browsing. Endpoint systems may be compromised through browsing to adversary controlled sites, as in Drive-by Compromise. In such cases, the user's web browser is typically targeted for exploitation (often not requiring any extra user interaction once landing on the site), but adversaries may also set up websites for non-exploitation behavior such as Application Access Token. Prior to Drive-by Compromise, adversaries must stage resources needed to deliver that exploit to users who browse to an adversary controlled site. Drive-by content can be staged on adversary controlled infrastructure that has been acquired (Acquire Infrastructure) or previously compromised (Compromise Infrastructure).

Adversaries may upload or inject malicious web content, such as JavaScript, into websites. This may be done in a number of ways, including:

- Inserting malicious scripts into web pages or other user controllable web content such as forum posts
- Modifying script files served to websites from publicly writeable cloud storage buckets
- Crafting malicious web advertisements and purchasing ad space on a website through legitimate ad providers (i.e., Malvertising)

In addition to staging content to exploit a user's web browser, adversaries may also stage scripting content to profile the user's browser (as in Gather Victim Host Information) to ensure it is vulnerable prior to attempting exploitation.

Websites compromised by an adversary and used to stage a drive-by may be ones visited by a specific community, such as government, a particular industry, or region, where the goal is to compromise a specific user or set of users based on a shared interest. This kind of targeted campaign is referred to a strategic web compromise or watering hole attack.

Adversaries may purchase domains similar to legitimate domains (ex: homoglyphs, typosquatting, different top-level domain, etc.) during acquisition of infrastructure (Domains) to help facilitate Drive-by Compromise.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Drive-by Target technique is applicable to target environment
- [ ] Check PRE systems for indicators of Drive-by Target
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Drive-by Target by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1608.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.

## Detection

### Detection of Drive-by Target

## Risk Assessment

| Finding                              | Severity | Impact               |
| ------------------------------------ | -------- | -------------------- |
| Drive-by Target technique applicable | High     | Resource Development |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [ATT ScanBox](https://cybersecurity.att.com/blogs/labs-research/scanbox-a-reconnaissance-framework-used-on-watering-hole-attacks)
- [Gallagher 2015](http://arstechnica.com/security/2015/08/newly-discovered-chinese-hacking-group-hacked-100-websites-to-use-as-watering-holes/)
- [FireEye CFR Watering Hole 2012](https://web.archive.org/web/20201024230407/https://www.fireeye.com/blog/threat-research/2012/12/council-foreign-relations-water-hole-attack-details.html)
- [Atomic Red Team - T1608.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1608.004)
- [MITRE ATT&CK - T1608.004](https://attack.mitre.org/techniques/T1608/004)
