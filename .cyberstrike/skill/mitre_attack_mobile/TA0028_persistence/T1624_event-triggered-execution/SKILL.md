---
name: "T1624_event-triggered-execution"
description: "Adversaries may establish persistence using system mechanisms that trigger execution based on specific events."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1624
  - persistence
  - android
technique_id: "T1624"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1624"
tech_stack:
  - android
cwe_ids:
  - CWE-276
chains_with:
  - T1624.001
prerequisites: []
severity_boost:
  T1624.001: "Chain with T1624.001 for deeper attack path"
---

# T1624 Event Triggered Execution

## High-Level Description

Adversaries may establish persistence using system mechanisms that trigger execution based on specific events. Mobile operating systems have means to subscribe to events such as receiving an SMS message, device boot completion, or other device activities.

Adversaries may abuse these mechanisms as a means of maintaining persistent access to a victim via automatically and repeatedly executing malicious code. After gaining access to a victim’s system, adversaries may create or modify event triggers to point to malicious content that will be executed whenever the event trigger is invoked.

## Kill Chain Phase

- Persistence (TA0028)

**Platforms:** Android

## What to Check

- [ ] Identify if Event Triggered Execution technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Event Triggered Execution
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Event Triggered Execution by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1624 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version

Android 8 introduced additional limitations on the implicit intents that an application can register for.

## Detection

### Detection of Event Triggered Execution

## Risk Assessment

| Finding                                        | Severity | Impact      |
| ---------------------------------------------- | -------- | ----------- |
| Event Triggered Execution technique applicable | Low      | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [MITRE ATT&CK Mobile - T1624](https://attack.mitre.org/techniques/T1624)
