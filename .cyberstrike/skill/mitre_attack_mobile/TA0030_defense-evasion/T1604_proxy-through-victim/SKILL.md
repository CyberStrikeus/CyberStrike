---
name: "T1604_proxy-through-victim"
description: "Adversaries may use a compromised device as a proxy server to the Internet."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1604
  - defense-evasion
  - android
technique_id: "T1604"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1604"
tech_stack:
  - android
cwe_ids:
  - CWE-693
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1604 Proxy Through Victim

## High-Level Description

Adversaries may use a compromised device as a proxy server to the Internet. By utilizing a proxy, adversaries hide the true IP address of their C2 server and associated infrastructure from the destination of the network traffic. This masquerades an adversary’s traffic as legitimate traffic originating from the compromised device, which can evade IP-based restrictions and alerts on certain services, such as bank accounts and social media websites.

The most common type of proxy is a SOCKS proxy. It can typically be implemented using standard OS-level APIs and 3rd party libraries with no indication to the user. On Android, adversaries can use the `Proxy` API to programmatically establish a SOCKS proxy connection, or lower-level APIs to interact directly with raw sockets.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android

## What to Check

- [ ] Identify if Proxy Through Victim technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Proxy Through Victim
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Proxy Through Victim by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1604 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Proxy Through Victim


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Proxy Through Victim technique applicable | Medium | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Threat Fabric Exobot](https://www.threatfabric.com/blogs/exobot_android_banking_trojan_on_the_rise.html)
- [MITRE ATT&CK Mobile - T1604](https://attack.mitre.org/techniques/T1604)
