---
name: "T1589.001_credentials"
description: "Adversaries may gather credentials that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1589.001
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1589.001"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1589/001"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1589
  - T1589.002
  - T1589.003
prerequisites:
  - T1589
severity_boost:
  T1589: "Chain with T1589 for deeper attack path"
  T1589.002: "Chain with T1589.002 for deeper attack path"
  T1589.003: "Chain with T1589.003 for deeper attack path"
---

# T1589.001 Credentials

> **Sub-technique of:** T1589

## High-Level Description

Adversaries may gather credentials that can be used during targeting. Account credentials gathered by adversaries may be those directly associated with the target victim organization or attempt to take advantage of the tendency for users to use the same passwords across personal and business accounts.

Adversaries may gather credentials from potential victims in various ways, such as direct elicitation via Phishing for Information. Adversaries may also compromise sites then add malicious content designed to collect website authentication cookies from visitors. Where multi-factor authentication (MFA) based on out-of-band communications is in use, adversaries may compromise a service provider to gain access to MFA codes and one-time passwords (OTP).

Credential information may also be exposed to adversaries via leaks to online or other accessible data sets (ex: Search Engines, breach dumps, code repositories, etc.). Adversaries may purchase credentials from dark web markets, such as Russian Market and 2easy, or through access to Telegram channels that distribute logs from infostealer malware.

Gathering this information may reveal opportunities for other forms of reconnaissance (ex: Search Open Websites/Domains or Phishing for Information), establishing operational resources (ex: Compromise Accounts), and/or initial access (ex: External Remote Services or Valid Accounts).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Credentials technique is applicable to target environment
- [ ] Check PRE systems for indicators of Credentials
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Credentials by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1589.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.

## Detection

### Detection of Credentials

## Risk Assessment

| Finding                          | Severity | Impact         |
| -------------------------------- | -------- | -------------- |
| Credentials technique applicable | High     | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Bleeping Computer 2easy 2021](https://www.bleepingcomputer.com/news/security/2easy-now-a-significant-dark-web-marketplace-for-stolen-data/)
- [ATT ScanBox](https://cybersecurity.att.com/blogs/labs-research/scanbox-a-reconnaissance-framework-used-on-watering-hole-attacks)
- [Detectify Slack Tokens](https://labs.detectify.com/writeups/slack-bot-token-leakage-exposing-business-critical-information/)
- [GitHub truffleHog](https://github.com/dxa4481/truffleHog)
- [Bleeping Computer Stealer Logs 2023](https://www.bleepingcomputer.com/news/security/dissecting-the-dark-web-supply-chain-stealer-logs-in-context/)
- [Register Uber](https://www.theregister.com/2015/02/28/uber_subpoenas_github_for_hacker_details/)
- [GitHub Gitrob](https://github.com/michenriksen/gitrob)
- [CNET Leaks](https://www.cnet.com/news/massive-breach-leaks-773-million-emails-21-million-passwords/)
- [Okta Scatter Swine 2022](https://sec.okta.com/scatterswine)
- [Forbes GitHub Creds](https://www.forbes.com/sites/runasandvik/2014/01/14/attackers-scrape-github-for-cloud-service-credentials-hijack-account-to-mine-virtual-currency/#242c479d3196)
- [SecureWorks Infostealers 2023](https://www.secureworks.com/research/the-growing-threat-from-infostealers)
- [Register Deloitte](https://www.theregister.com/2017/09/26/deloitte_leak_github_and_google/)
- [Atomic Red Team - T1589.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1589.001)
- [MITRE ATT&CK - T1589.001](https://attack.mitre.org/techniques/T1589/001)
