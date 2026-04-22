---
name: "T0883_internet-accessible-device"
description: "Adversaries may gain access into industrial environments through systems exposed directly to the internet for remote access rather than through External Remote Services."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0883
  - initial-access
technique_id: "T0883"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0883"
tech_stack:
  - ics
cwe_ids:
  - CWE-20
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0883 Internet Accessible Device

## High-Level Description

Adversaries may gain access into industrial environments through systems exposed directly to the internet for remote access rather than through External Remote Services. Internet Accessible Devices are exposed to the internet unintentionally or intentionally without adequate protections. This may allow for adversaries to move directly into the control system network. Access onto these devices is accomplished without the use of exploits, these would be represented within the Exploit Public-Facing Application technique.

Adversaries may leverage built in functions for remote access which may not be protected or utilize minimal legacy protections that may be targeted. These services may be discoverable through the use of online scanning tools.

In the case of the Bowman dam incident, adversaries leveraged access to the dam control network through a cellular modem. Access to the device was protected by password authentication, although the application was vulnerable to brute forcing.

In Trend Micros manufacturing deception operations adversaries were detected leveraging direct internet access to an ICS environment through the exposure of operational protocols such as Siemens S7, Omron FINS, and EtherNet/IP, in addition to misconfigured VNC access.

## Kill Chain Phase

- Initial Access (TA0108)

**Platforms:** ICS

## What to Check

- [ ] Identify if Internet Accessible Device technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Internet Accessible Device
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Internet Accessible Device by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0883 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0930 Network Segmentation

Deny direct remote access to internal systems through the use of network proxies, gateways, and firewalls. Steps should be taken to periodically inventory internet accessible devices to determine if it differs from the expected.

## Detection

### Detection of Internet Accessible Device

## Risk Assessment

| Finding                                         | Severity | Impact         |
| ----------------------------------------------- | -------- | -------------- |
| Internet Accessible Device technique applicable | High     | Initial Access |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [Danny Yadron December 2015](https://www.wsj.com/articles/iranian-hackers-infiltrated-new-york-dam-in-2013-1450662559)
- [Mark Thompson March 2016](https://time.com/4270728/iran-cyber-attack-dam-fbi/)
- [NCCIC January 2014](https://www.us-cert.gov/sites/default/files/Monitors/ICS-CERT_Monitor_Jan-April2014.pdf)
- [Stephen Hilt, Federico Maggi, Charles Perine, Lord Remorin, Martin Rsler, and Rainer Vosseler](https://documents.trendmicro.com/assets/white_papers/wp-caught-in-the-act-running-a-realistic-factory-honeypot-to-capture-real-threats.pdf)
- [MITRE ATT&CK ICS - T0883](https://attack.mitre.org/techniques/T0883)
