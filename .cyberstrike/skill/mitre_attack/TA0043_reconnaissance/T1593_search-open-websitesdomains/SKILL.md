---
name: "T1593_search-open-websitesdomains"
description: "Adversaries may search freely available websites and/or domains for information about victims that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1593
  - reconnaissance
  - pre
technique_id: "T1593"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1593"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1593.001
  - T1593.002
  - T1593.003
prerequisites:
  []
severity_boost:
  T1593.001: "Chain with T1593.001 for deeper attack path"
  T1593.002: "Chain with T1593.002 for deeper attack path"
  T1593.003: "Chain with T1593.003 for deeper attack path"
---

# T1593 Search Open Websites/Domains

## High-Level Description

Adversaries may search freely available websites and/or domains for information about victims that can be used during targeting. Information about victims may be available in various online sites, such as social media, new sites, or those hosting information about business operations such as hiring or requested/rewarded contracts.

Adversaries may search in different online sites depending on what information they seek to gather. Information from these sources may reveal opportunities for other forms of reconnaissance (ex: Phishing for Information or Search Open Technical Databases), establishing operational resources (ex: Establish Accounts or Compromise Accounts), and/or initial access (ex: External Remote Services or Phishing).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Search Open Websites/Domains technique is applicable to target environment
- [ ] Check PRE systems for indicators of Search Open Websites/Domains
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Search Open Websites/Domains by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1593 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1047 Audit
Scan public code repositories for exposed credentials or other sensitive information before making commits. Ensure that any leaked credentials are removed from the commit history, not just the current latest version of the code.

### M1013 Application Developer Guidance
Application developers uploading to public code repositories should be careful to avoid publishing sensitive information such as credentials and API keys.


## Detection

### Detection of Search Open Websites/Domains


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Search Open Websites/Domains technique applicable | High | Reconnaissance |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [SecurityTrails Google Hacking](https://www.recordedfuture.com/threat-intelligence-101/threat-analysis-techniques/google-dorks)
- [Cyware Social Media](https://cyware.com/news/how-hackers-exploit-social-media-to-break-into-your-company-88e8da8e)
- [ExploitDB GoogleHacking](https://www.exploit-db.com/google-hacking-database)
- [Atomic Red Team - T1593](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1593)
- [MITRE ATT&CK - T1593](https://attack.mitre.org/techniques/T1593)
