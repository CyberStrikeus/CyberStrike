---
name: "T1583.008_malvertising"
description: "Adversaries may purchase online advertisements that can be abused to distribute malware to victims."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1583.008
  - resource-development
  - pre
  - sub-technique
technique_id: "T1583.008"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1583/008"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1583
  - T1583.001
  - T1583.002
  - T1583.003
  - T1583.004
  - T1583.005
  - T1583.006
  - T1583.007
prerequisites:
  - T1583
severity_boost:
  T1583: "Chain with T1583 for deeper attack path"
  T1583.001: "Chain with T1583.001 for deeper attack path"
  T1583.002: "Chain with T1583.002 for deeper attack path"
---

# T1583.008 Malvertising

> **Sub-technique of:** T1583

## High-Level Description

Adversaries may purchase online advertisements that can be abused to distribute malware to victims. Ads can be purchased to plant as well as favorably position artifacts in specific locations online, such as prominently placed within search engine results. These ads may make it more difficult for users to distinguish between actual search results and advertisements. Purchased ads may also target specific audiences using the advertising network’s capabilities, potentially further taking advantage of the trust inherently given to search engines and popular websites. 

Adversaries may purchase ads and other resources to help distribute artifacts containing malicious code to victims. Purchased ads may attempt to impersonate or spoof well-known brands. For example, these spoofed ads may trick victims into clicking the ad which could then send them to a malicious domain that may be a clone of official websites containing trojanized versions of the advertised software. Adversary’s efforts to create malicious domains and purchase advertisements may also be automated at scale to better resist cleanup efforts. 

Malvertising may be used to support Drive-by Target and Drive-by Compromise, potentially requiring limited interaction from the user if the ad contains code/exploits that infect the target system's web browser.

Adversaries may also employ several techniques to evade detection by the advertising network. For example, adversaries may dynamically route ad clicks to send automated crawler/policy enforcer traffic to benign sites while validating potential targets then sending victims referred from real ad clicks to malicious pages. This infection vector may therefore remain hidden from the ad network as well as any visitor not reaching the malicious sites with a valid identifier from clicking on the advertisement. Other tricks, such as intentional typos to avoid brand reputation monitoring, may also be used to evade automated detection.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Malvertising technique is applicable to target environment
- [ ] Check PRE systems for indicators of Malvertising
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Malvertising by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1583.008 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should be focused on initial access activities, such as drive by compromise where ad blocking adblockers can help prevent malicious code from executing.


## Detection

### Detection of Malvertising


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Malvertising technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [BBC-malvertising](https://www.bbc.com/news/technology-12891182)
- [FBI-search](https://www.ic3.gov/Media/Y2022/PSA221221)
- [sentinelone-malvertising](https://www.sentinelone.com/blog/breaking-down-the-seo-poisoning-attack-how-attackers-are-hijacking-search-results/)
- [spamhaus-malvertising](https://www.spamhaus.com/resource-center/a-surge-of-malvertising-across-google-ads-is-distributing-dangerous-malware/)
- [Masquerads-Guardio](https://labs.guard.io/masquerads-googles-ad-words-massively-abused-by-threat-actors-targeting-organizations-gpus-42ae73ee8a1e)
- [Atomic Red Team - T1583.008](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1583.008)
- [MITRE ATT&CK - T1583.008](https://attack.mitre.org/techniques/T1583/008)
