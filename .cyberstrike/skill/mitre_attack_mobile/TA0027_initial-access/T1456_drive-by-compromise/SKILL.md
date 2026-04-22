---
name: "T1456_drive-by-compromise"
description: "Adversaries may gain access to a system through a user visiting a website over the normal course of browsing."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1456
  - initial-access
  - android
  - ios
technique_id: "T1456"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1456"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-20
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1456 Drive-By Compromise

## High-Level Description

Adversaries may gain access to a system through a user visiting a website over the normal course of browsing. With this technique, the user's web browser is typically targeted for exploitation, but adversaries may also use compromised websites for non-exploitation behavior such as acquiring an Application Access Token.

Multiple ways of delivering exploit code to a browser exist, including:

- A legitimate website is compromised where adversaries have injected some form of malicious code such as JavaScript, iFrames, and cross-site scripting.
- Malicious ads are paid for and served through legitimate ad providers.
- Built-in web application interfaces are leveraged for the insertion of any other kind of object that can be used to display web content or contain a script that executes on the visiting client (e.g. forum posts, comments, and other user controllable web content).

Often the website used by an adversary is one visited by a specific community, such as government, a particular industry, or region, where the goal is to compromise a specific user or set of users based on a shared interest. This kind of targeted attack is referred to a strategic web compromise or watering hole attack. There are several known examples of this occurring.

Typical drive-by compromise process:

1. A user visits a website that is used to host the adversary controlled content.
2. Scripts automatically execute, typically searching versions of the browser and plugins for a potentially vulnerable version.

- The user may be required to assist in this process by enabling scripting or active website components and ignoring warning dialog boxes.

3. Upon finding a vulnerable version, exploit code is delivered to the browser.
4. If exploitation is successful, then it will give the adversary code execution on the user's system unless other protections are in place.

- In some cases a second visit to the website after the initial scan is required before exploit code is delivered.

## Kill Chain Phase

- Initial Access (TA0027)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Drive-By Compromise technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Drive-By Compromise
- [ ] Check iOS devices for indicators of Drive-By Compromise
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Drive-By Compromise by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1456 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1001 Security Updates

Security updates frequently contain patches for known exploits.

## Detection

### Detection of Drive-By Compromise

## Risk Assessment

| Finding                                  | Severity | Impact         |
| ---------------------------------------- | -------- | -------------- |
| Drive-By Compromise technique applicable | High     | Initial Access |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [Lookout-StealthMango](https://info.lookout.com/rs/051-ESQ-475/images/lookout-stealth-mango-srr-us.pdf)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/cellular-threats/CEL-22.html)
- [MITRE ATT&CK Mobile - T1456](https://attack.mitre.org/techniques/T1456)
