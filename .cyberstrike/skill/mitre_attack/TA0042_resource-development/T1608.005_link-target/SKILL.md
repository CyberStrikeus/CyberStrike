---
name: "T1608.005_link-target"
description: "Adversaries may put in place resources that are referenced by a link that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1608.005
  - resource-development
  - pre
  - sub-technique
technique_id: "T1608.005"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1608/005"
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
  - T1608.006
prerequisites:
  - T1608
severity_boost:
  T1608: "Chain with T1608 for deeper attack path"
  T1608.001: "Chain with T1608.001 for deeper attack path"
  T1608.002: "Chain with T1608.002 for deeper attack path"
---

# T1608.005 Link Target

> **Sub-technique of:** T1608

## High-Level Description

Adversaries may put in place resources that are referenced by a link that can be used during targeting. An adversary may rely upon a user clicking a malicious link in order to divulge information (including credentials) or to gain execution, as in Malicious Link. Links can be used for spearphishing, such as sending an email accompanied by social engineering text to coax the user to actively click or copy and paste a URL into a browser. Prior to a phish for information (as in Spearphishing Link) or a phish to gain initial access to a system (as in Spearphishing Link), an adversary must set up the resources for a link target for the spearphishing link. 

Typically, the resources for a link target will be an HTML page that may include some client-side script such as JavaScript to decide what content to serve to the user. Adversaries may clone legitimate sites to serve as the link target, this can include cloning of login pages of legitimate web services or organization login pages in an effort to harvest credentials during Spearphishing Link. Adversaries may also Upload Malware and have the link target point to malware for download/execution by the user.

Adversaries may purchase domains similar to legitimate domains (ex: homoglyphs, typosquatting, different top-level domain, etc.) during acquisition of infrastructure (Domains) to help facilitate Malicious Link.

Links can be written by adversaries to mask the true destination in order to deceive victims by abusing the URL schema and increasing the effectiveness of phishing.

Adversaries may also use free or paid accounts on link shortening services and Platform-as-a-Service providers to host link targets while taking advantage of the widely trusted domains of those providers to avoid being blocked while redirecting victims to malicious pages. In addition, adversaries may serve a variety of malicious links through uniquely generated URIs/URLs (including one-time, single use links). Finally, adversaries may take advantage of the decentralized nature of the InterPlanetary File System (IPFS) to host link targets that are difficult to remove.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Link Target technique is applicable to target environment
- [ ] Check PRE systems for indicators of Link Target
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Link Target by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1608.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Link Target


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Link Target technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [Netskope GCP Redirection](https://www.netskope.com/blog/targeted-attacks-abusing-google-cloud-platform-open-redirection)
- [Netskope Cloud Phishing](https://www.netskope.com/blog/a-big-catch-cloud-phishing-from-google-app-engine-and-azure-app-service)
- [URI Unique](https://media.defense.gov/2020/Jun/09/2002313081/-1/-1/0/CSI-DETECT-AND-PREVENT-WEB-SHELL-MALWARE-20200422.PDF)
- [Kaspersky-masking](https://www.kaspersky.com/blog/malicious-redirect-methods/50045/)
- [Talos IPFS 2022](https://blog.talosintelligence.com/ipfs-abuse/)
- [Malwarebytes Silent Librarian October 2020](https://blog.malwarebytes.com/malwarebytes-news/2020/10/silent-librarian-apt-phishing-attack/)
- [URI](https://www.techtarget.com/searchsecurity/tip/Preparing-for-uniform-resource-identifier-URI-exploits)
- [URI Use](https://www.blackhat.com/presentations/bh-dc-08/McFeters-Rios-Carter/Presentation/bh-dc-08-mcfeters-rios-carter.pdf)
- [iOS URL Scheme](https://docs.ostorlab.co/kb/IPA_URL_SCHEME_HIJACKING/index.html)
- [Intezer App Service Phishing](https://www.intezer.com/blog/malware-analysis/kud-i-enter-your-server-new-vulnerabilities-in-microsoft-azure/)
- [Proofpoint TA407 September 2019](https://www.proofpoint.com/us/threat-insight/post/threat-actor-profile-ta407-silent-librarian)
- [Cofense-redirect](https://cofense.com/blog/major-energy-company-targeted-in-large-qr-code-campaign/)
- [mandiant-masking](https://www.mandiant.com/resources/blog/url-obfuscation-schema-abuse)
- [Atomic Red Team - T1608.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1608.005)
- [MITRE ATT&CK - T1608.005](https://attack.mitre.org/techniques/T1608/005)
