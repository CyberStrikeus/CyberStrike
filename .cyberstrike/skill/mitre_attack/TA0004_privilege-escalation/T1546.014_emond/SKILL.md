---
name: "T1546.014_emond"
description: "Adversaries may gain persistence and elevate privileges by executing malicious content triggered by the Event Monitor Daemon (emond)."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1546.014
  - privilege-escalation
  - persistence
  - macos
  - sub-technique
technique_id: "T1546.014"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - persistence
platforms:
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1546/014"
tech_stack:
  - macos
cwe_ids:
  - CWE-269
chains_with:
  - T1546
  - T1546.001
  - T1546.002
  - T1546.003
  - T1546.004
  - T1546.005
  - T1546.006
  - T1546.007
  - T1546.008
  - T1546.009
  - T1546.010
  - T1546.011
  - T1546.012
  - T1546.013
  - T1546.015
  - T1546.016
  - T1546.017
  - T1546.018
prerequisites:
  - T1546
severity_boost:
  T1546: "Chain with T1546 for deeper attack path"
  T1546.001: "Chain with T1546.001 for deeper attack path"
  T1546.002: "Chain with T1546.002 for deeper attack path"
---

# T1546.014 Emond

> **Sub-technique of:** T1546

## High-Level Description

Adversaries may gain persistence and elevate privileges by executing malicious content triggered by the Event Monitor Daemon (emond). Emond is a Launch Daemon that accepts events from various services, runs them through a simple rules engine, and takes action. The emond binary at <code>/sbin/emond</code> will load any rules from the <code>/etc/emond.d/rules/</code> directory and take action once an explicitly defined event takes place.

The rule files are in the plist format and define the name, event type, and action to take. Some examples of event types include system startup and user authentication. Examples of actions are to run a system command or send an email. The emond service will not launch if there is no file present in the QueueDirectories path <code>/private/var/db/emondClients</code>, specified in the Launch Daemon configuration file at<code>/System/Library/LaunchDaemons/com.apple.emond.plist</code>.

Adversaries may abuse this service by writing a rule to execute commands when a defined event occurs, such as system start up or user authentication. Adversaries may also be able to escalate privileges from administrator to root as the emond service is executed with root privileges by the Launch Daemon service.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Persistence (TA0003)

**Platforms:** macOS

## What to Check

- [ ] Identify if Emond technique is applicable to target environment
- [ ] Check macOS systems for indicators of Emond
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Persistance with Event Monitor - emond

Establish persistence via a rule run by OSX's emond (Event Monitor) daemon at startup, based on https://posts.specterops.io/leveraging-emond-on-macos-for-persistence-a040a2785124

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo cp "#{plist}" /etc/emond.d/rules/T1546.014_emond.plist
sudo touch /private/var/db/emondClients/T1546.014
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Emond by examining the target platforms (macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1546.014 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

Consider disabling emond by removing the Launch Daemon plist file.

## Detection

### Detection Strategy for Event Triggered Execution via emond on macOS

## Risk Assessment

| Finding                    | Severity | Impact               |
| -------------------------- | -------- | -------------------- |
| Emond technique applicable | High     | Privilege Escalation |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-269 | Improper Privilege Management |

## References

- [magnusviri emond Apr 2016](http://www.magnusviri.com/Mac/what-is-emond.html)
- [xorrior emond Jan 2018](https://www.xorrior.com/emond-persistence/)
- [sentinelone macos persist Jun 2019](https://www.sentinelone.com/blog/how-malware-persists-on-macos/)
- [Atomic Red Team - T1546.014](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1546.014)
- [MITRE ATT&CK - T1546.014](https://attack.mitre.org/techniques/T1546/014)
