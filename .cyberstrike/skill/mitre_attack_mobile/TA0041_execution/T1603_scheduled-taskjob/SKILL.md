---
name: "T1603_scheduled-taskjob"
description: "Adversaries may abuse task scheduling functionality to facilitate initial or recurring execution of malicious code."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1603
  - execution
  - persistence
  - android
  - ios
technique_id: "T1603"
tactic: "execution"
all_tactics:
  - execution
  - persistence
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1603"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-94
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1603 Scheduled Task/Job

## High-Level Description

Adversaries may abuse task scheduling functionality to facilitate initial or recurring execution of malicious code. On Android and iOS, APIs and libraries exist to facilitate scheduling tasks to execute at a specified date, time, or interval.

On Android, the `WorkManager` API allows asynchronous tasks to be scheduled with the system. `WorkManager` was introduced to unify task scheduling on Android, using `JobScheduler`, `GcmNetworkManager`, and `AlarmManager` internally. `WorkManager` offers a lot of flexibility for scheduling, including periodically, one time, or constraint-based (e.g. only when the device is charging).

On iOS, the `NSBackgroundActivityScheduler` API allows asynchronous tasks to be scheduled with the system. The tasks can be scheduled to be repeating or non-repeating, however, the system chooses when the tasks will be executed. The app can choose the interval for repeating tasks, or the delay between scheduling and execution for one-time tasks.

## Kill Chain Phase

- Execution (TA0041)
- Persistence (TA0028)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Scheduled Task/Job technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Scheduled Task/Job
- [ ] Check iOS devices for indicators of Scheduled Task/Job
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Scheduled Task/Job by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1603 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Scheduled Task/Job

## Risk Assessment

| Finding                                 | Severity | Impact    |
| --------------------------------------- | -------- | --------- |
| Scheduled Task/Job technique applicable | Low      | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Apple NSBackgroundActivityScheduler](https://developer.apple.com/documentation/foundation/nsbackgroundactivityscheduler)
- [Android WorkManager](https://developer.android.com/topic/libraries/architecture/workmanager)
- [MITRE ATT&CK Mobile - T1603](https://attack.mitre.org/techniques/T1603)
