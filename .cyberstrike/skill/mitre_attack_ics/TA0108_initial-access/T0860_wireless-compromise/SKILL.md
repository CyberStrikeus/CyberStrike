---
name: "T0860_wireless-compromise"
description: "Adversaries may perform wireless compromise as a method of gaining communications and unauthorized access to a wireless network."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0860
  - initial-access
technique_id: "T0860"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0860"
tech_stack:
  - ics
cwe_ids:
  - CWE-20
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0860 Wireless Compromise

## High-Level Description

Adversaries may perform wireless compromise as a method of gaining communications and unauthorized access to a wireless network. Access to a wireless network may be gained through the compromise of a wireless device. Adversaries may also utilize radios and other wireless communication devices on the same frequency as the wireless network. Wireless compromise can be done as an initial access vector from a remote distance.

A Polish student used a modified TV remote controller to gain access to and control over the Lodz city tram system in Poland. The remote controller device allowed the student to interface with the trams network to modify track settings and override operator control. The adversary may have accomplished this by aligning the controller to the frequency and amplitude of IR control protocol signals. The controller then enabled initial access to the network, allowing the capture and replay of tram signals.

## Kill Chain Phase

- Initial Access (TA0108)

**Platforms:** ICS

## What to Check

- [ ] Identify if Wireless Compromise technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Wireless Compromise
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Wireless Compromise by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0860 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0802 Communication Authenticity

Do not inherently rely on the authenticity provided by the network/link layer (e.g., 802.11, LTE, 802.15.4), as link layer equipment may have long lifespans and protocol vulnerabilities may not be easily patched. Provide defense-in-depth by implementing authenticity within the associated application-layer protocol, or through a network-layer VPN. Furthermore, ensure communication schemes provide strong replay protection, employing techniques such as timestamps or cryptographic nonces.

### M0813 Software Process and Device Authentication

Ensure wireless networks require the authentication of all devices, and that all wireless devices also authenticate network infrastructure devices (i.e., mutual authentication). For defense-in-depth purposes, utilize VPNs or ensure that application-layer protocols also authenticate the system or device. Use protocols that provide strong authentication (e.g., IEEE 802.1X), and enforce basic protections, such as MAC filtering, when stronger cryptographic techniques are not available.

### M0806 Minimize Wireless Signal Propagation

Techniques can include (i) reducing transmission power on wireless signals, (ii) adjusting antenna gain to prevent extensions beyond organizational boundaries, and (iii) employing RF shielding techniques to block excessive signal propagation.

### M0808 Encrypt Network Traffic

Utilize strong cryptographic techniques and protocols to prevent eavesdropping on network communications.

## Detection

### Detection of Wireless Compromise

## Risk Assessment

| Finding                                  | Severity | Impact         |
| ---------------------------------------- | -------- | -------------- |
| Wireless Compromise technique applicable | Low      | Initial Access |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [Alexander Bolshev March 2014](https://www.slideshare.net/slideshow/17-bolshev-1-13/32178888)
- [Alexander Bolshev, Gleb Cherbov July 2014](https://www.blackhat.com/docs/us-14/materials/us-14-Bolshev-ICSCorsair-How-I-Will-PWN-Your-ERP-Through-4-20mA-Current-Loop-WP.pdf)
- [Bruce Schneier January 2008](https://www.schneier.com/blog/archives/2008/01/hacking_the_pol.html)
- [John Bill May 2017](https://www.londonreconnections.com/2017/hacked-cyber-security-railways/)
- [Shelley Smith February 2008](https://inhomelandsecurity.com/teen_hacker_in_poland_plays_tr/)
- [MITRE ATT&CK ICS - T0860](https://attack.mitre.org/techniques/T0860)
