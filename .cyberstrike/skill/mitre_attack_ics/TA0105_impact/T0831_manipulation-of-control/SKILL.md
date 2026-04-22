---
name: "T0831_manipulation-of-control"
description: "Adversaries may manipulate physical process control within the industrial environment."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0831
  - impact
technique_id: "T0831"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0831"
tech_stack:
  - ics
cwe_ids:
  - CWE-400
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0831 Manipulation of Control

## High-Level Description

Adversaries may manipulate physical process control within the industrial environment. Methods of manipulating control can include changes to set point values, tags, or other parameters. Adversaries may manipulate control systems devices or possibly leverage their own, to communicate with and command physical control processes. The duration of manipulation may be temporary or longer sustained, depending on operator detection. 

Methods of Manipulation of Control include: 

* Man-in-the-middle 
* Spoof command message 
* Changing setpoints 

A Polish student used a remote controller device to interface with the Lodz city tram system in Poland. Using this remote, the student was able to capture and replay legitimate tram signals. As a consequence, four trams were derailed and twelve people injured due to resulting emergency stops. The track controlling commands issued may have also resulted in tram collisions, a further risk to those on board and nearby the areas of impact.

## Kill Chain Phase

- Impact (TA0105)

**Platforms:** ICS

## What to Check

- [ ] Identify if Manipulation of Control technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Manipulation of Control
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Manipulation of Control by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0831 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0810 Out-of-Band Communications Channel
Utilize out-of-band communication to validate the integrity of data from the primary channel.

### M0953 Data Backup
Take and store data backups from end user systems and critical servers. Ensure backup and storage systems are hardened and kept separate from the corporate network to prevent compromise. Maintain and exercise incident response plans , including the management of gold-copy back-up images and configurations for key systems to enable quick recovery and response from adversarial activities that impact control, view, or availability.

### M0802 Communication Authenticity
Protocols used for control functions should provide authenticity through MAC functions or digital signatures. If not, utilize bump-in-the-wire devices or VPNs to enforce communication authenticity between devices that are not capable of supporting this (e.g., legacy controllers, RTUs).


## Detection

### Detection of Manipulation of Control


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Manipulation of Control technique applicable | High | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [Bruce Schneier January 2008](https://www.schneier.com/blog/archives/2008/01/hacking_the_pol.html)
- [John Bill May 2017](https://www.londonreconnections.com/2017/hacked-cyber-security-railways/)
- [Shelley Smith February 2008](https://inhomelandsecurity.com/teen_hacker_in_poland_plays_tr/)
- [MITRE ATT&CK ICS - T0831](https://attack.mitre.org/techniques/T0831)
