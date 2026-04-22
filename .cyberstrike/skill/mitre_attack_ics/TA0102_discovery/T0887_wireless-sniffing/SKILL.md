---
name: "T0887_wireless-sniffing"
description: "Adversaries may seek to capture radio frequency (RF) communication used for remote control and reporting in distributed environments."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0887
  - discovery
  - collection
technique_id: "T0887"
tactic: "discovery"
all_tactics:
  - discovery
  - collection
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0887"
tech_stack:
  - ics
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0887 Wireless Sniffing

## High-Level Description

Adversaries may seek to capture radio frequency (RF) communication used for remote control and reporting in distributed environments. RF communication frequencies vary between 3 kHz to 300 GHz, although are commonly between 300 MHz to 6 GHz. The wavelength and frequency of the signal affect how the signal propagates through open air, obstacles (e.g. walls and trees) and the type of radio required to capture them. These characteristics are often standardized in the protocol and hardware and may have an effect on how the signal is captured. Some examples of wireless protocols that may be found in cyber-physical environments are: WirelessHART, Zigbee, WIA-FA, and 700 MHz Public Safety Spectrum. 

Adversaries may capture RF communications by using specialized hardware, such as software defined radio (SDR), handheld radio, or a computer with radio demodulator tuned to the communication frequency. Information transmitted over a wireless medium may be captured in-transit whether the sniffing device is the intended destination or not. This technique may be particularly useful to an adversary when the communications are not encrypted. 

In the 2017 Dallas Siren incident, it is suspected that adversaries likely captured wireless command message broadcasts on a 700 MHz frequency during a regular test of the system. These messages were later replayed to trigger the alarm systems.

## Kill Chain Phase

- Discovery (TA0102)
- Collection (TA0100)

**Platforms:** ICS

## What to Check

- [ ] Identify if Wireless Sniffing technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Wireless Sniffing
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Wireless Sniffing by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0887 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0806 Minimize Wireless Signal Propagation
Reduce the range of RF communications to their intended operating range when possible. Propagation reduction methods may include (i) reducing transmission power on wireless signals, (ii) adjusting antenna gain to prevent extensions beyond organizational boundaries, and (iii) employing RF shielding techniques to block excessive signal propagation.

### M0808 Encrypt Network Traffic
Utilize strong cryptographic techniques and protocols to prevent eavesdropping on network communications.


## Detection

### Detection of Wireless Sniffing


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Wireless Sniffing technique applicable | Low | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Bastille April 2017](https://www.bastille.net/blogs/2017/4/17/dallas-siren-attack)
- [Candell, R., Hany, M., Lee, K. B., Liu,Y., Quimby, J., Remley, K. April 2018](https://nvlpubs.nist.gov/nistpubs/ams/NIST.AMS.300-4.pdf)
- [Gallagher, S. April 2017](https://arstechnica.com/information-technology/2017/04/dallas-siren-hack-used-radio-signals-to-spoof-alarm-says-city-manager/)
- [MITRE ATT&CK ICS - T0887](https://attack.mitre.org/techniques/T0887)
