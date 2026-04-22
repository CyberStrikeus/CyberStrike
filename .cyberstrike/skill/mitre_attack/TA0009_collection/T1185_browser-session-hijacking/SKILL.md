---
name: "T1185_browser-session-hijacking"
description: "Adversaries may take advantage of security vulnerabilities and inherent functionality in browser software to change content, modify user-behaviors, and intercept information as part of various brow..."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1185
  - collection
  - windows
technique_id: "T1185"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1185"
tech_stack:
  - windows
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1185 Browser Session Hijacking

## High-Level Description

Adversaries may take advantage of security vulnerabilities and inherent functionality in browser software to change content, modify user-behaviors, and intercept information as part of various browser session hijacking techniques.

A specific example is when an adversary injects software into a browser that allows them to inherit cookies, HTTP sessions, and SSL client certificates of a user then use the browser as a way to pivot into an authenticated intranet. Executing browser-based behaviors such as pivoting may require specific process permissions, such as <code>SeDebugPrivilege</code> and/or high-integrity/administrator rights.

Another example involves pivoting browser traffic from the adversary's browser through the user's browser by setting up a proxy which will redirect web traffic. This does not alter the user's traffic in any way, and the proxy connection can be severed as soon as the browser is closed. The adversary assumes the security context of whichever browser process the proxy is injected into. Browsers typically create a new process for each tab that is opened and permissions and certificates are separated accordingly. With these permissions, an adversary could potentially browse to any resource on an intranet, such as Sharepoint or webmail, that is accessible through the browser and which the browser has sufficient permissions. Browser pivoting may also bypass security provided by 2-factor authentication.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Windows

## What to Check

- [ ] Identify if Browser Session Hijacking technique is applicable to target environment
- [ ] Check Windows systems for indicators of Browser Session Hijacking
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Browser Session Hijacking by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1185 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1017 User Training
Close all browser sessions regularly and when they are no longer needed.

### M1018 User Account Management
Since browser pivoting requires a high integrity process to launch from, restricting user permissions and addressing Privilege Escalation and Bypass User Account Control opportunities can limit the exposure to this technique.


## Detection

### Detect browser session hijacking via privilege, handle access, and remote thread into browsers


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Browser Session Hijacking technique applicable | High | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Wikipedia Man in the Browser](https://en.wikipedia.org/wiki/Man-in-the-browser)
- [Cobalt Strike Browser Pivot](https://www.cobaltstrike.com/help-browser-pivoting)
- [ICEBRG Chrome Extensions](https://www.icebrg.io/blog/malicious-chrome-extensions-enable-criminals-to-impact-over-half-a-million-users-and-global-businesses)
- [cobaltstrike manual](https://web.archive.org/web/20210825130434/https://cobaltstrike.com/downloads/csmanual38.pdf)
- [Atomic Red Team - T1185](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1185)
- [MITRE ATT&CK - T1185](https://attack.mitre.org/techniques/T1185)
