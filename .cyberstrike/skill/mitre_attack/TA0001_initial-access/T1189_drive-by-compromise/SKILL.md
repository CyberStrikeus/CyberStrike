---
name: "T1189_drive-by-compromise"
description: "Adversaries may gain access to a system through a user visiting a website over the normal course of browsing."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1189
  - initial-access
  - identity-provider
  - linux
  - macos
  - windows
technique_id: "T1189"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Identity Provider
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1189"
tech_stack:
  - identity
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-20
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1189 Drive-by Compromise

## High-Level Description

Adversaries may gain access to a system through a user visiting a website over the normal course of browsing. Multiple ways of delivering exploit code to a browser exist (i.e., Drive-by Target), including:

* A legitimate website is compromised, allowing adversaries to inject malicious code
* Script files served to a legitimate website from a publicly writeable cloud storage bucket are modified by an adversary
* Malicious ads are paid for and served through legitimate ad providers (i.e., Malvertising)
* Built-in web application interfaces that allow user-controllable content are leveraged for the insertion of malicious scripts or iFrames (e.g., cross-site scripting)

Browser push notifications may also be abused by adversaries and leveraged for malicious code injection via User Execution. By clicking "allow" on browser push notifications, users may be granting a website permission to run JavaScript code on their browser.

Often the website used by an adversary is one visited by a specific community, such as government, a particular industry, or a particular region, where the goal is to compromise a specific user or set of users based on a shared interest. This kind of targeted campaign is often referred to a strategic web compromise or watering hole attack. There are several known examples of this occurring.

Typical drive-by compromise process:

1. A user visits a website that is used to host the adversary controlled content.
2. Scripts automatically execute, typically searching versions of the browser and plugins for a potentially vulnerable version. The user may be required to assist in this process by enabling scripting, notifications, or active website components and ignoring warning dialog boxes.
3. Upon finding a vulnerable version, exploit code is delivered to the browser.
4. If exploitation is successful, the adversary will gain code execution on the user's system unless other protections are in place. In some cases, a second visit to the website after the initial scan is required before exploit code is delivered.

Unlike Exploit Public-Facing Application, the focus of this technique is to exploit software on a client endpoint upon visiting a website. This will commonly give an adversary access to systems on the internal network instead of external systems that may be in a DMZ.

## Kill Chain Phase

- Initial Access (TA0001)

**Platforms:** Identity Provider, Linux, macOS, Windows

## What to Check

- [ ] Identify if Drive-by Compromise technique is applicable to target environment
- [ ] Check Identity Provider systems for indicators of Drive-by Compromise
- [ ] Check Linux systems for indicators of Drive-by Compromise
- [ ] Check macOS systems for indicators of Drive-by Compromise
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Drive-by Compromise by examining the target platforms (Identity Provider, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1189 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1050 Exploit Protection
Security applications that look for behavior used during exploitation such as Windows Defender Exploit Guard (WDEG) and the Enhanced Mitigation Experience Toolkit (EMET) can be used to mitigate some exploitation behavior. Control flow integrity checking is another way to potentially identify and stop a software exploit from occurring. Many of these protections depend on the architecture and target application binary for compatibility.

### M1051 Update Software
Ensuring that all browsers and plugins are kept updated can help prevent the exploit phase of this technique. Use modern browsers with security features turned on.

### M1048 Application Isolation and Sandboxing
Browser sandboxes can be used to mitigate some of the impact of exploitation, but sandbox escapes may still exist.

Other types of virtualization and application microsegmentation may also mitigate the impact of client-side exploitation. The risks of additional exploits and weaknesses in implementation may still exist for these types of systems.

### M1021 Restrict Web-Based Content
Adblockers can help prevent malicious code served through ads from executing in the first place. Script blocking extensions can also help to prevent the execution of JavaScript. 

Consider disabling browser push notifications from certain applications and browsers.

### M1017 User Training
Train users to be aware of access or manipulation attempts by an adversary to reduce the risk of successful spearphishing, social engineering, and other techniques that involve user interaction.


## Detection

### Drive-by Compromise — Behavior-based, Multi-platform Detection Strategy (T1189)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Drive-by Compromise technique applicable | High | Initial Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [Shadowserver Strategic Web Compromise](http://blog.shadowserver.org/2012/05/15/cyber-espionage-strategic-web-compromises-trusted-websites-serving-dangerous-results/)
- [push notification -mcafee](https://www.mcafee.com/blogs/other-blogs/mcafee-labs/scammers-impersonating-windows-defender-to-push-malicious-windows-apps/)
- [Push notifications - viruspositive](https://viruspositive.com/resources/blogs/the-dark-side-of-web-push-notifications)
- [push notifications - malwarebytes](https://www.malwarebytes.com/blog/news/2019/01/browser-push-notifications-feature-asking-abused)
- [Atomic Red Team - T1189](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1189)
- [MITRE ATT&CK - T1189](https://attack.mitre.org/techniques/T1189)
