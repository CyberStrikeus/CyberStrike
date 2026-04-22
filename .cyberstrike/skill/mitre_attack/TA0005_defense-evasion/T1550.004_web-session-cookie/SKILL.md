---
name: "T1550.004_web-session-cookie"
description: "Adversaries can use stolen session cookies to authenticate to web applications and services."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1550.004
  - defense-evasion
  - lateral-movement
  - saas
  - iaas
  - office-suite
  - sub-technique
technique_id: "T1550.004"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - lateral-movement
platforms:
  - SaaS
  - IaaS
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1550/004"
tech_stack:
  - saas
  - cloud
  - office
cwe_ids:
  - CWE-693
chains_with:
  - T1550
  - T1550.001
  - T1550.002
  - T1550.003
prerequisites:
  - T1550
severity_boost:
  T1550: "Chain with T1550 for deeper attack path"
  T1550.001: "Chain with T1550.001 for deeper attack path"
  T1550.002: "Chain with T1550.002 for deeper attack path"
---

# T1550.004 Web Session Cookie

> **Sub-technique of:** T1550

## High-Level Description

Adversaries can use stolen session cookies to authenticate to web applications and services. This technique bypasses some multi-factor authentication protocols since the session is already authenticated.

Authentication cookies are commonly used in web applications, including cloud-based services, after a user has authenticated to the service so credentials are not passed and re-authentication does not need to occur as frequently. Cookies are often valid for an extended period of time, even if the web application is not actively used. After the cookie is obtained through Steal Web Session Cookie or Web Cookies, the adversary may then import the cookie into a browser they control and is then able to use the site or application as the user for as long as the session cookie is active. Once logged into the site, an adversary can access sensitive information, read email, or perform actions that the victim account has permissions to perform.

There have been examples of malware targeting session cookies to bypass multi-factor authentication systems.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Lateral Movement (TA0008)

**Platforms:** SaaS, IaaS, Office Suite

## What to Check

- [ ] Identify if Web Session Cookie technique is applicable to target environment
- [ ] Check SaaS systems for indicators of Web Session Cookie
- [ ] Check IaaS systems for indicators of Web Session Cookie
- [ ] Check Office Suite systems for indicators of Web Session Cookie
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Web Session Cookie by examining the target platforms (SaaS, IaaS, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1550.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1054 Software Configuration

Configure browsers or tasks to regularly delete persistent cookies.

## Detection

### Detect Use of Stolen Web Session Cookies Across Platforms

## Risk Assessment

| Finding                                 | Severity | Impact          |
| --------------------------------------- | -------- | --------------- |
| Web Session Cookie technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Unit 42 Mac Crypto Cookies January 2019](https://unit42.paloaltonetworks.com/mac-malware-steals-cryptocurrency-exchanges-cookies/)
- [Pass The Cookie](https://wunderwuzzi23.github.io/blog/passthecookie.html)
- [Atomic Red Team - T1550.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1550.004)
- [MITRE ATT&CK - T1550.004](https://attack.mitre.org/techniques/T1550/004)
