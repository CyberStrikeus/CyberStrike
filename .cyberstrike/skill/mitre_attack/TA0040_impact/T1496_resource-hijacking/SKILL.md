---
name: "T1496_resource-hijacking"
description: "Adversaries may leverage the resources of co-opted systems to complete resource-intensive tasks, which may impact system and/or hosted service availability."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1496
  - impact
  - windows
  - iaas
  - linux
  - macos
  - containers
  - saas
technique_id: "T1496"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Windows
  - IaaS
  - Linux
  - macOS
  - Containers
  - SaaS
mitre_url: "https://attack.mitre.org/techniques/T1496"
tech_stack:
  - windows
  - cloud
  - linux
  - macos
  - containers
  - saas
cwe_ids:
  - CWE-400
chains_with:
  - T1496.001
  - T1496.002
  - T1496.003
  - T1496.004
prerequisites:
  []
severity_boost:
  T1496.001: "Chain with T1496.001 for deeper attack path"
  T1496.002: "Chain with T1496.002 for deeper attack path"
  T1496.003: "Chain with T1496.003 for deeper attack path"
---

# T1496 Resource Hijacking

## High-Level Description

Adversaries may leverage the resources of co-opted systems to complete resource-intensive tasks, which may impact system and/or hosted service availability. 

Resource hijacking may take a number of different forms. For example, adversaries may:

* Leverage compute resources in order to mine cryptocurrency
* Sell network bandwidth to proxy networks
* Generate SMS traffic for profit
* Abuse cloud-based messaging services to send large quantities of spam messages

In some cases, adversaries may leverage multiple types of Resource Hijacking at once.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Windows, IaaS, Linux, macOS, Containers, SaaS

## What to Check

- [ ] Identify if Resource Hijacking technique is applicable to target environment
- [ ] Check Windows systems for indicators of Resource Hijacking
- [ ] Check IaaS systems for indicators of Resource Hijacking
- [ ] Check Linux systems for indicators of Resource Hijacking
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: FreeBSD/macOS/Linux - Simulate CPU Load with Yes

This test simulates a high CPU load as you might observe during cryptojacking attacks.
End the test by using CTRL/CMD+C to break.

**Supported Platforms:** linux, macos

```bash
yes > /dev/null
```

### Atomic Test 2: Windows - Simulate CPU Load with PowerShell

This test simulates high CPU load using PowerShell, commonly seen in resource hijacking.
Spawns background jobs to stress CPU cores for a specified duration.

**Supported Platforms:** windows

```powershell
$end = (Get-Date).AddSeconds(#{duration_seconds})
1..#{cpu_threads} | ForEach-Object { Start-Job { param($t) while((Get-Date) -lt $t) { $i=0; while($i -lt 200000){$i++} } } -ArgumentList $end }
Get-Job | Wait-Job | Remove-Job
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Resource Hijacking by examining the target platforms (Windows, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1496 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Resource Hijacking Detection Strategy


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Resource Hijacking technique applicable | High | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [Sysdig Cryptojacking Proxyjacking 2023](https://sysdig.com/blog/labrat-cryptojacking-proxyjacking-campaign/)
- [Atomic Red Team - T1496](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1496)
- [MITRE ATT&CK - T1496](https://attack.mitre.org/techniques/T1496)
