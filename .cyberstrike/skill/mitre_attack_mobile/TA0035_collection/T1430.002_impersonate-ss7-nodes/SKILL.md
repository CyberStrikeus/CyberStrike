---
name: "T1430.002_impersonate-ss7-nodes"
description: "Adversaries may exploit the lack of authentication in signaling system network nodes to track the location of mobile devices by impersonating a node."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1430.002
  - collection
  - discovery
  - android
  - ios
  - sub-technique
technique_id: "T1430.002"
tactic: "collection"
all_tactics:
  - collection
  - discovery
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1430/002"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with:
  - T1430
  - T1430.001
prerequisites:
  - T1430
severity_boost:
  T1430: "Chain with T1430 for deeper attack path"
  T1430.001: "Chain with T1430.001 for deeper attack path"
---

# T1430.002 Impersonate SS7 Nodes

> **Sub-technique of:** T1430

## High-Level Description

Adversaries may exploit the lack of authentication in signaling system network nodes to track the location of mobile devices by impersonating a node. 

 

By providing the victim’s MSISDN (phone number) and impersonating network internal nodes to query subscriber information from other nodes, adversaries may use data collected from each hop to eventually determine the device’s geographical cell area or nearest cell tower.

## Kill Chain Phase

- Collection (TA0035)
- Discovery (TA0032)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Impersonate SS7 Nodes technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Impersonate SS7 Nodes
- [ ] Check iOS devices for indicators of Impersonate SS7 Nodes
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Impersonate SS7 Nodes by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1430.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1014 Interconnection Filtering
Filtering requests by checking request origin information may provide some defense against spurious operators.


## Detection

### Detection of Impersonate SS7 Nodes


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Impersonate SS7 Nodes technique applicable | High | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [3GPP-Security](http://www.3gpp.org/ftp/tsg_sa/wg3_security/_specs/33900-120.pdf)
- [CSRIC5-WG10-FinalReport](https://web.archive.org/web/20200330012714/https://www.fcc.gov/files/csric5-wg10-finalreport031517pdf)
- [Positive-SS7](https://www.ptsecurity.com/upload/ptcom/PT-SS7-AD-Data-Sheet-eng.pdf)
- [Engel-SS7-2008](https://www.youtube.com/watch?v=q0n5ySqbfdI)
- [Engel-SS7](https://berlin.ccc.de/~tobias/31c3-ss7-locate-track-manipulate.pdf)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/cellular-threats/CEL-38.html)
- [MITRE ATT&CK Mobile - T1430.002](https://attack.mitre.org/techniques/T1430/002)
