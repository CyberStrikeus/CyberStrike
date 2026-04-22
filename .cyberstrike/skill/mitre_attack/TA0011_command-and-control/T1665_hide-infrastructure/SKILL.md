---
name: "T1665_hide-infrastructure"
description: "Adversaries may manipulate network traffic in order to hide and evade detection of their C2 infrastructure."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1665
  - command-and-control
  - esxi
  - linux
  - network-devices
  - windows
  - macos
technique_id: "T1665"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - ESXi
  - Linux
  - Network Devices
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1665"
tech_stack:
  - esxi
  - linux
  - network devices
  - windows
  - macos
cwe_ids:
  - CWE-300
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1665 Hide Infrastructure

## High-Level Description

Adversaries may manipulate network traffic in order to hide and evade detection of their C2 infrastructure. This can be accomplished by identifying and filtering traffic from defensive tools, masking malicious domains to obfuscate the true destination from both automated scanning tools and security researchers, and otherwise hiding malicious artifacts to delay discovery and prolong the effectiveness of adversary infrastructure that could otherwise be identified, blocked, or taken down entirely.

C2 networks may include the use of Proxy or VPNs to disguise IP addresses, which can allow adversaries to blend in with normal network traffic and bypass conditional access policies or anti-abuse protections. For example, an adversary may use a virtual private cloud to spoof their IP address to closer align with a victim's IP address ranges. This may also bypass security measures relying on geolocation of the source IP address.

Adversaries may also attempt to filter network traffic in order to evade defensive tools in numerous ways, including blocking/redirecting common incident responder or security appliance user agents. Filtering traffic based on IP and geo-fencing may also avoid automated sandboxing or researcher activity (i.e., Virtualization/Sandbox Evasion).

Hiding C2 infrastructure may also be supported by Resource Development activities such as Acquire Infrastructure and Compromise Infrastructure. For example, using widely trusted hosting services or domains such as prominent URL shortening providers or marketing services for C2 networks may enable adversaries to present benign content that later redirects victims to malicious web pages or infrastructure once specific conditions are met.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** ESXi, Linux, Network Devices, Windows, macOS

## What to Check

- [ ] Identify if Hide Infrastructure technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Hide Infrastructure
- [ ] Check Linux systems for indicators of Hide Infrastructure
- [ ] Check Network Devices systems for indicators of Hide Infrastructure
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Hide Infrastructure by examining the target platforms (ESXi, Linux, Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1665 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Hide Infrastructure


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Hide Infrastructure technique applicable | Medium | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [SocGholish-update](https://www.proofpoint.com/us/blog/threat-insight/part-1-socgholish-very-real-threat-very-fake-update)
- [TA571](https://www.proofpoint.com/us/blog/threat-insight/security-brief-ta571-delivers-icedid-forked-loader)
- [mod_rewrite](https://bluescreenofjeff.com/2016-04-12-combatting-incident-responders-with-apache-mod_rewrite/)
- [Browser-updates](https://www.proofpoint.com/us/blog/threat-insight/are-you-sure-your-browser-date-current-landscape-fake-browser-updates)
- [StarBlizzard](https://www.microsoft.com/en-us/security/blog/2023/12/07/star-blizzard-increases-sophistication-and-evasion-in-ongoing-attacks/)
- [QR-cofense](https://cofense.com/blog/major-energy-company-targeted-in-large-qr-code-campaign/)
- [Schema-abuse](https://www.mandiant.com/resources/blog/url-obfuscation-schema-abuse)
- [Orange Residential Proxies](https://www.orangecyberdefense.com/global/blog/research/residential-proxies)
- [Facad1ng](https://github.com/spyboy-productions/Facad1ng)
- [sysdig](https://sysdig.com/content/c/pf-2023-global-cloud-threat-report?x=u_WFRi&xs=524303#page=1)
- [Atomic Red Team - T1665](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1665)
- [MITRE ATT&CK - T1665](https://attack.mitre.org/techniques/T1665)
