---
name: "T0822_external-remote-services"
description: "Adversaries may leverage external remote services as a point of initial access into your network."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0822
  - initial-access
technique_id: "T0822"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0822"
tech_stack:
  - ics
cwe_ids:
  - CWE-20
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0822 External Remote Services

## High-Level Description

Adversaries may leverage external remote services as a point of initial access into your network. These services allow users to connect to internal network resources from external locations. Examples are VPNs, Citrix, and other access mechanisms. Remote service gateways often manage connections and credential authentication for these services.

External remote services allow administration of a control system from outside the system. Often, vendors and internal engineering groups have access to external remote services to control system networks via the corporate network. In some cases, this access is enabled directly from the internet. While remote access enables ease of maintenance when a control system is in a remote area, compromise of remote access solutions is a liability. The adversary may use these services to gain access to and execute attacks against a control system network. Access to valid accounts is often a requirement.

As they look for an entry point into the control system network, adversaries may begin searching for existing point-to-point VPN implementations at trusted third party networks or through remote support employee connections where split tunneling is enabled.

## Kill Chain Phase

- Initial Access (TA0108)

**Platforms:** ICS

## What to Check

- [ ] Identify if External Remote Services technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of External Remote Services
- [ ] Verify mitigations are bypassed or absent (7 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to External Remote Services by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0822 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0930 Network Segmentation

Deny direct remote access to internal systems through the use of network proxies, gateways, and firewalls. Consider a jump server or host into the DMZ for greater access control. Leverage this DMZ or corporate resources for vendor access.

### M0936 Account Use Policies

Configure features related to account use like login attempt lockouts, specific login times, and password strength requirements as examples. Consider these features as they relate to assets which may impact safety and availability.

### M0935 Limit Access to Resource Over Network

Limit access to remote services through centrally managed concentrators such as VPNs and other managed remote access systems.

### M0927 Password Policies

Set and enforce secure password policies for accounts.

### M0918 User Account Management

Consider utilizing jump boxes for external remote access. Additionally, dynamic account management may be used to easily remove accounts when not in use.

### M0942 Disable or Remove Feature or Program

Consider removal of remote services which are not regularly in use, or only enabling them when required (e.g., vendor remote access). Ensure all external remote access point (e.g., jump boxes, VPN concentrator) are configured with least functionality, especially the removal of unnecessary services.

### M0932 Multi-factor Authentication

Use strong multi-factor authentication for remote service accounts to mitigate an adversary's ability to leverage stolen credentials. Be aware of multi-factor authentication interception techniques for some implementations.

## Detection

### Detection of External Remote Services

## Risk Assessment

| Finding                                       | Severity | Impact         |
| --------------------------------------------- | -------- | -------------- |
| External Remote Services technique applicable | High     | Initial Access |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [Daniel Oakley, Travis Smith, Tripwire](https://attack.mitre.org/wiki/Technique/T1133)
- [Electricity Information Sharing and Analysis Center; SANS Industrial Control Systems March 2016](https://assets.contentstack.io/v3/assets/blt36c2e63521272fdc/blt6a77276749b76a40/607f235992f0063e5c070fff/E-ISAC_SANS_Ukraine_DUC_5%5b73%5d.pdf)
- [MITRE ATT&CK ICS - T0822](https://attack.mitre.org/techniques/T0822)
