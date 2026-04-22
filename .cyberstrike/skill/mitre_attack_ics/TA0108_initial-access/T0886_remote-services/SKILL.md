---
name: "T0886_remote-services"
description: "Adversaries may leverage remote services to move between assets and network segments."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0886
  - initial-access
  - lateral-movement
technique_id: "T0886"
tactic: "initial-access"
all_tactics:
  - initial-access
  - lateral-movement
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0886"
tech_stack:
  - ics
cwe_ids:
  - CWE-20
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0886 Remote Services

## High-Level Description

Adversaries may leverage remote services to move between assets and network segments. These services are often used to allow operators to interact with systems remotely within the network, some examples are RDP, SMB, SSH, and other similar mechanisms. 

Remote services could be used to support remote access, data transmission, authentication, name resolution, and other remote functions. Further, remote services may be necessary to allow operators and administrators to configure systems within the network from their engineering or management workstations. An adversary may use this technique to access devices which may be dual-homed to multiple network segments, and can be used for Program Download or to execute attacks on control devices directly through Valid Accounts.

Specific remote services (RDP & VNC) may be a precursor to enable Graphical User Interface execution on devices such as HMIs or engineering workstation software.

Based on incident data, CISA and FBI assessed that Chinese state-sponsored actors also compromised various authorized remote access channels, including systems designed to transfer data and/or allow access between corporate and ICS networks.

## Kill Chain Phase

- Initial Access (TA0108)
- Lateral Movement (TA0109)

**Platforms:** ICS

## What to Check

- [ ] Identify if Remote Services technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Remote Services
- [ ] Verify mitigations are bypassed or absent (9 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Remote Services by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0886 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0813 Software Process and Device Authentication
All communication sessions to remote services should be authenticated to prevent unauthorized access.

### M0800 Authorization Enforcement
Provide privileges corresponding to the restriction of a GUI session to control system operations (examples include HMI read-only vs. read-write modes). Ensure local users, such as operators and engineers, are giving prioritization over remote sessions and have the authority to regain control over a remote session if needed. Prevent remote access sessions (e.g., RDP, VNC) from taking over local sessions, especially those used for ICS control, especially HMIs.

### M0930 Network Segmentation
Segment and control software movement between business and OT environments by way of one directional DMZs. Web access should be restricted from the OT environment. Engineering workstations, including transient cyber assets (TCAs) should have minimal connectivity to external networks, including Internet and email, further limit the extent to which these devices are dual-homed to multiple networks.

### M0927 Password Policies
Enforce strong password requirements to prevent password brute force methods for lateral movement.

### M0804 Human User Authentication
All remote services should require strong authentication before providing user access.

### M0807 Network Allowlists
Network allowlists can be implemented through either host-based files or system host files to specify what external connections (e.g., IP address, MAC address, port, protocol) can be made from a device.

### M0918 User Account Management
Limit the accounts that may use remote services. Limit the permissions for accounts that are at higher risk of compromise; for example, configure SSH so users can only run specific programs.

### M0801 Access Management
Access Management technologies can help enforce authentication on critical remote service, examples include, but are not limited to, device management services (e.g., telnet, SSH), data access servers (e.g., HTTP, Historians), and HMI sessions (e.g., RDP, VNC).

### M0937 Filter Network Traffic
Filter application-layer protocol messages for remote services to block any unauthorized activity.


## Detection

### Detection of Remote Services


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Remote Services technique applicable | Low | Initial Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [Blake Johnson, Dan Caban, Marina Krotofil, Dan Scali, Nathan Brubaker, Christopher Glyer December 2017](https://www.fireeye.com/blog/threat-research/2017/12/attackers-deploy-new-ics-attack-framework-triton.html)
- [CISA AA21-201A Pipeline Intrusion July 2021](https://us-cert.cisa.gov/sites/default/files/publications/AA21-201A_Chinese_Gas_Pipeline_Intrusion_Campaign_2011_to_2013%20(1).pdf)
- [Dragos December 2017](https://dragos.com/blog/trisis/TRISIS-01.pdf)
- [Joe Slowik April 2019](https://dragos.com/blog/industry-news/implications-of-it-ransomware-for-ics-environments/)
- [MITRE ATT&CK ICS - T0886](https://attack.mitre.org/techniques/T0886)
