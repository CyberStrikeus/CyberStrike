---
name: "T1584.002_dns-server"
description: "Adversaries may compromise third-party DNS servers that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1584.002
  - resource-development
  - pre
  - sub-technique
technique_id: "T1584.002"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1584/002"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1584
  - T1584.001
  - T1584.003
  - T1584.004
  - T1584.005
  - T1584.006
  - T1584.007
  - T1584.008
prerequisites:
  - T1584
severity_boost:
  T1584: "Chain with T1584 for deeper attack path"
  T1584.001: "Chain with T1584.001 for deeper attack path"
  T1584.003: "Chain with T1584.003 for deeper attack path"
---

# T1584.002 DNS Server

> **Sub-technique of:** T1584

## High-Level Description

Adversaries may compromise third-party DNS servers that can be used during targeting. During post-compromise activity, adversaries may utilize DNS traffic for various tasks, including for Command and Control (ex: Application Layer Protocol). Instead of setting up their own DNS servers, adversaries may compromise third-party DNS servers in support of operations.

By compromising DNS servers, adversaries can alter DNS records. Such control can allow for redirection of an organization's traffic, facilitating Collection and Credential Access efforts for the adversary. Additionally, adversaries may leverage such control in conjunction with Digital Certificates to redirect traffic to adversary-controlled infrastructure, mimicking normal trusted network communications. Alternatively, they may be able to prove ownership of a domain to a SaaS service in order to assert control of the service or create a new administrative Cloud Account. Adversaries may also be able to silently create subdomains pointed at malicious servers without tipping off the actual owner of the DNS server.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if DNS Server technique is applicable to target environment
- [ ] Check PRE systems for indicators of DNS Server
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to DNS Server by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1584.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of DNS Server


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| DNS Server technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [FireEye DNS Hijack 2019](https://www.fireeye.com/blog/threat-research/2019/01/global-dns-hijacking-campaign-dns-record-manipulation-at-scale.html)
- [Crowdstrike DNS Hijack 2019](https://www.crowdstrike.com/blog/widespread-dns-hijacking-activity-targets-multiple-sectors/)
- [Talos DNSpionage Nov 2018](https://blog.talosintelligence.com/2018/11/dnspionage-campaign-targets-middle-east.html)
- [CiscoAngler](https://blogs.cisco.com/security/talos/angler-domain-shadowing)
- [Proofpoint Domain Shadowing](https://www.proofpoint.com/us/threat-insight/post/The-Shadow-Knows)
- [CyberCX SaaS Domain Hijacking 2025](https://cybercx.com.au/blog/keys-to-the-saas-kingdom/)
- [Atomic Red Team - T1584.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1584.002)
- [MITRE ATT&CK - T1584.002](https://attack.mitre.org/techniques/T1584/002)
