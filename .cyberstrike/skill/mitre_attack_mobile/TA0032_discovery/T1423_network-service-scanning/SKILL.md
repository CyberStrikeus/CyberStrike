---
name: "T1423_network-service-scanning"
description: "Adversaries may attempt to get a listing of services running on remote hosts, including those that may be vulnerable to remote software exploitation."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1423
  - discovery
  - android
  - ios
technique_id: "T1423"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1423"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1423 Network Service Scanning

## High-Level Description

Adversaries may attempt to get a listing of services running on remote hosts, including those that may be vulnerable to remote software exploitation. Methods to acquire this information include port scans and vulnerability scans from the mobile device. This technique may take advantage of the mobile device's access to an internal enterprise network either through local connectivity or through a Virtual Private Network (VPN).

## Kill Chain Phase

- Discovery (TA0032)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Network Service Scanning technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Network Service Scanning
- [ ] Check iOS devices for indicators of Network Service Scanning
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Network Service Scanning by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1423 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Network Service Scanning

## Risk Assessment

| Finding                                       | Severity | Impact    |
| --------------------------------------------- | -------- | --------- |
| Network Service Scanning technique applicable | High     | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [MITRE ATT&CK Mobile - T1423](https://attack.mitre.org/techniques/T1423)
