---
name: "T1590.002_dns"
description: "Adversaries may gather information about the victim's DNS that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1590.002
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1590.002"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1590/002"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1590
  - T1590.001
  - T1590.003
  - T1590.004
  - T1590.005
  - T1590.006
prerequisites:
  - T1590
severity_boost:
  T1590: "Chain with T1590 for deeper attack path"
  T1590.001: "Chain with T1590.001 for deeper attack path"
  T1590.003: "Chain with T1590.003 for deeper attack path"
---

# T1590.002 DNS

> **Sub-technique of:** T1590

## High-Level Description

Adversaries may gather information about the victim's DNS that can be used during targeting. DNS information may include a variety of details, including registered name servers as well as records that outline addressing for a target’s subdomains, mail servers, and other hosts. DNS MX, TXT, and SPF records may also reveal the use of third party cloud and SaaS providers, such as Office 365, G Suite, Salesforce, or Zendesk.

Adversaries may gather this information in various ways, such as querying or otherwise collecting details via DNS/Passive DNS. DNS information may also be exposed to adversaries via online or other accessible data sets (ex: Search Open Technical Databases). Gathering this information may reveal opportunities for other forms of reconnaissance (ex: Search Open Technical Databases, Search Open Websites/Domains, or Active Scanning), establishing operational resources (ex: Acquire Infrastructure or Compromise Infrastructure), and/or initial access (ex: External Remote Services).

Adversaries may also use DNS zone transfer (DNS query type AXFR) to collect all records from a misconfigured DNS server.

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if DNS technique is applicable to target environment
- [ ] Check PRE systems for indicators of DNS
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to DNS by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1590.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1054 Software Configuration

Consider implementing policies for DNS servers, such as Zone Transfer Policies, that enforce a list of validated servers permitted for zone transfers.

## Detection

### Detection of DNS

## Risk Assessment

| Finding                  | Severity | Impact         |
| ------------------------ | -------- | -------------- |
| DNS technique applicable | Low      | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Circl Passive DNS](https://www.circl.lu/services/passive-dns/)
- [DNS-CISA](https://www.cisa.gov/news-events/alerts/2015/04/13/dns-zone-transfer-axfr-requests-may-leak-domain-information)
- [DNS Dumpster](https://dnsdumpster.com/)
- [Alexa-dns](https://en.internetwache.org/scanning-alexas-top-1m-for-axfr-29-03-2015/)
- [Sean Metcalf Twitter DNS Records](https://x.com/PyroTek3/status/1126487227712921600)
- [Trails-DNS](https://web.archive.org/web/20180615055527/https://securitytrails.com/blog/russian-tlds)
- [Atomic Red Team - T1590.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1590.002)
- [MITRE ATT&CK - T1590.002](https://attack.mitre.org/techniques/T1590/002)
