---
name: "T1583.001_domains"
description: "Adversaries may acquire domains that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1583.001
  - resource-development
  - pre
  - sub-technique
technique_id: "T1583.001"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1583/001"
tech_stack:
  - pre
cwe_ids: []
chains_with:
  - T1583
  - T1583.002
  - T1583.003
  - T1583.004
  - T1583.005
  - T1583.006
  - T1583.007
  - T1583.008
prerequisites:
  - T1583
severity_boost:
  T1583: "Chain with T1583 for deeper attack path"
  T1583.002: "Chain with T1583.002 for deeper attack path"
  T1583.003: "Chain with T1583.003 for deeper attack path"
---

# T1583.001 Domains

> **Sub-technique of:** T1583

## High-Level Description

Adversaries may acquire domains that can be used during targeting. Domain names are the human readable names used to represent one or more IP addresses. They can be purchased or, in some cases, acquired for free.

Adversaries may use acquired domains for a variety of purposes, including for Phishing, Drive-by Compromise, and Command and Control. Adversaries may choose domains that are similar to legitimate domains, including through use of homoglyphs or use of a different top-level domain (TLD). Typosquatting may be used to aid in delivery of payloads via Drive-by Compromise. Adversaries may also use internationalized domain names (IDNs) and different character sets (e.g. Cyrillic, Greek, etc.) to execute "IDN homograph attacks," creating visually similar lookalike domains used to deliver malware to victim machines.

Different URIs/URLs may also be dynamically generated to uniquely serve malicious content to victims (including one-time, single use domain names).

Adversaries may also acquire and repurpose expired domains, which may be potentially already allowlisted/trusted by defenders based on an existing reputation/history.

Domain registrars each maintain a publicly viewable database that displays contact information for every registered domain. Private WHOIS services display alternative information, such as their own company data, rather than the owner of the domain. Adversaries may use such private WHOIS services to obscure information about who owns a purchased domain. Adversaries may further interrupt efforts to track their infrastructure by using varied registration information and purchasing domains with different domain registrars.

In addition to legitimately purchasing a domain, an adversary may register a new domain in a compromised environment. For example, in AWS environments, adversaries may leverage the Route53 domain service to register a domain and create hosted zones pointing to resources of the threat actor’s choosing.

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

2. **Assess Existing Defenses**: Review whether mitigations for T1583.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

Organizations may intentionally register similar domains to their own to deter adversaries from creating typosquatting domains. Other facets of this technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.

## Detection

### Detection of Domains

## Risk Assessment

| Finding                      | Severity | Impact               |
| ---------------------------- | -------- | -------------------- |
| Domains technique applicable | High     | Resource Development |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [URI Unique](https://media.defense.gov/2020/Jun/09/2002313081/-1/-1/0/CSI-DETECT-AND-PREVENT-WEB-SHELL-MALWARE-20200422.PDF)
- [PaypalScam](https://www.zdnet.com/article/paypal-alert-beware-the-paypai-scam-5000109103/)
- [CISA IDN ST05-016](https://us-cert.cisa.gov/ncas/tips/ST05-016)
- [CISA MSS Sep 2020](https://us-cert.cisa.gov/ncas/alerts/aa20-258a)
- [bypass_webproxy_filtering](https://www.blackhillsinfosec.com/bypass-web-proxy-filtering/)
- [FireEye APT28](https://web.archive.org/web/20151022204649/https://www.fireeye.com/content/dam/fireeye-www/global/en/current-threats/pdfs/rpt-apt28.pdf)
- [Invictus IR DangerDev 2024](https://www.invictus-ir.com/news/the-curious-case-of-dangerdev-protonmail-me)
- [Domain_Steal_CC](https://krebsonsecurity.com/2018/11/that-domain-you-forgot-to-renew-yeah-its-now-stealing-credit-cards/)
- [tt_obliqueRAT](https://blog.talosintelligence.com/2021/05/transparent-tribe-infra-and-targeting.html)
- [tt_httrack_fake_domains](https://blog.talosintelligence.com/2022/03/transparent-tribe-new-campaign.html)
- [Mandiant APT1](https://www.fireeye.com/content/dam/fireeye-www/services/pdfs/mandiant-apt1-report.pdf)
- [Categorisation_not_boundary](https://www.mdsec.co.uk/2017/07/categorisation-is-not-a-security-boundary/)
- [URI](https://www.techtarget.com/searchsecurity/tip/Preparing-for-uniform-resource-identifier-URI-exploits)
- [Redirectors_Domain_Fronting](https://www.cobaltstrike.com/blog/high-reputation-redirectors-and-domain-fronting/)
- [URI Use](https://www.blackhat.com/presentations/bh-dc-08/McFeters-Rios-Carter/Presentation/bh-dc-08-mcfeters-rios-carter.pdf)
- [iOS URL Scheme](https://docs.ostorlab.co/kb/IPA_URL_SCHEME_HIJACKING/index.html)
- [lazgroup_idn_phishing](https://web.archive.org/web/20171223000420/https://www.riskiq.com/blog/labs/lazarus-group-cryptocurrency/)
- [httrack_unhcr](https://web.archive.org/web/20220527112908/https://www.riskiq.com/blog/labs/ukraine-malware-infrastructure/)
- [ThreatConnect Infrastructure Dec 2020](https://threatconnect.com/blog/infrastructure-research-hunting/)
- [Atomic Red Team - T1583.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1583.001)
