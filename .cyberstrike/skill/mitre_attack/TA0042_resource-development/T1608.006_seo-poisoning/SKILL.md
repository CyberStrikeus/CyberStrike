---
name: "T1608.006_seo-poisoning"
description: "Adversaries may poison mechanisms that influence search engine optimization (SEO) to further lure staged capabilities towards potential victims."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1608.006
  - resource-development
  - pre
  - sub-technique
technique_id: "T1608.006"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1608/006"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1608
  - T1608.001
  - T1608.002
  - T1608.003
  - T1608.004
  - T1608.005
prerequisites:
  - T1608
severity_boost:
  T1608: "Chain with T1608 for deeper attack path"
  T1608.001: "Chain with T1608.001 for deeper attack path"
  T1608.002: "Chain with T1608.002 for deeper attack path"
---

# T1608.006 SEO Poisoning

> **Sub-technique of:** T1608

## High-Level Description

Adversaries may poison mechanisms that influence search engine optimization (SEO) to further lure staged capabilities towards potential victims. Search engines typically display results to users based on purchased ads as well as the site’s ranking/score/reputation calculated by their web crawlers and algorithms.

To help facilitate Drive-by Compromise, adversaries may stage content that explicitly manipulates SEO rankings in order to promote sites hosting their malicious payloads (such as Drive-by Target) within search engines. Poisoning SEO rankings may involve various tricks, such as stuffing keywords (including in the form of hidden text) into compromised sites. These keywords could be related to the interests/browsing habits of the intended victim(s) as well as more broad, seasonably popular topics (e.g. elections, trending news).

In addition to internet search engines (such as Google), adversaries may also aim to manipulate specific in-site searches for developer platforms (such as GitHub) to deceive users towards Supply Chain Compromise lures. In-site searches will rank search results according to their own algorithms and metrics such as popularity which may be targeted and gamed by malicious actors.

Adversaries may also purchase or plant incoming links to staged capabilities in order to boost the site’s calculated relevance and reputation.

SEO poisoning may also be combined with evasive redirects and other cloaking mechanisms (such as measuring mouse movements or serving content based on browser user agents, user language/localization settings, or HTTP headers) in order to feed SEO inputs while avoiding scrutiny from defenders.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if SEO Poisoning technique is applicable to target environment
- [ ] Check PRE systems for indicators of SEO Poisoning
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to SEO Poisoning by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1608.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of SEO Poisoning


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SEO Poisoning technique applicable | Low | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [MalwareBytes SEO](https://www.malwarebytes.com/blog/news/2018/05/seo-poisoning-is-it-worth-it)
- [Atlas SEO](https://atlas-cybersecurity.com/cyber-threats/threat-actors-use-search-engine-optimization-tactics-to-redirect-traffic-and-install-malware/)
- [Sophos Gootloader](https://news.sophos.com/en-us/2021/03/01/gootloader-expands-its-payload-delivery-options/)
- [DFIR Report Gootloader](https://thedfirreport.com/2022/05/09/seo-poisoning-a-gootloader-story/)
- [ZScaler SEO](https://www.zscaler.com/blogs/security-research/ubiquitous-seo-poisoning-urls-0)
- [Chexmarx-seo](https://zero.checkmarx.com/the-github-black-market-gaming-the-star-ranking-game-fc42f5913fb7)
- [Checkmarx-oss-seo](https://checkmarx.com/blog/new-technique-to-trick-developers-detected-in-an-open-source-supply-chain-attack/)
- [Atomic Red Team - T1608.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1608.006)
- [MITRE ATT&CK - T1608.006](https://attack.mitre.org/techniques/T1608/006)
