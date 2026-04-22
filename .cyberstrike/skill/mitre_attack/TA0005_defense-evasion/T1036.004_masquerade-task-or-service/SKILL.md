---
name: "T1036.004_masquerade-task-or-service"
description: "Adversaries may attempt to manipulate the name of a task or service to make it appear legitimate or benign."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1036.004
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1036.004"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1036/004"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1036
  - T1036.001
  - T1036.002
  - T1036.003
  - T1036.005
  - T1036.006
  - T1036.007
  - T1036.008
  - T1036.009
  - T1036.010
  - T1036.011
  - T1036.012
prerequisites:
  - T1036
severity_boost:
  T1036: "Chain with T1036 for deeper attack path"
  T1036.001: "Chain with T1036.001 for deeper attack path"
  T1036.002: "Chain with T1036.002 for deeper attack path"
---

# T1036.004 Masquerade Task or Service

> **Sub-technique of:** T1036

## High-Level Description

Adversaries may attempt to manipulate the name of a task or service to make it appear legitimate or benign. Tasks/services executed by the Task Scheduler or systemd will typically be given a name and/or description. Windows services will have a service name as well as a display name. Many benign tasks and services exist that have commonly associated names. Adversaries may give tasks or services names that are similar or identical to those of legitimate ones.

Tasks or services contain other fields, such as a description, that adversaries may attempt to make appear legitimate.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Masquerade Task or Service technique is applicable to target environment
- [ ] Check Linux systems for indicators of Masquerade Task or Service
- [ ] Check macOS systems for indicators of Masquerade Task or Service
- [ ] Check Windows systems for indicators of Masquerade Task or Service
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Creating W32Time similar named service using schtasks

Creating W32Time similar named service (win32times) using schtasks just like threat actor dubbed "Operation Wocao"

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
schtasks /create /ru system /sc daily /tr "cmd /c powershell.exe -ep bypass -file c:\T1036.004_NonExistingScript.ps1" /tn win32times /f
schtasks /query /tn win32times
```

### Atomic Test 2: Creating W32Time similar named service using sc

Creating W32Time similar named service (win32times) using sc just like threat actor dubbed "Operation Wocao"

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
sc create win32times binPath= "cmd /c start c:\T1036.004_NonExistingScript.ps1"
sc qc win32times
```

### Atomic Test 3: linux rename /proc/pid/comm using prctl

Runs a C program that calls prctl(PR_SET_NAME) to modify /proc/pid/comm value to "totally_legit". This will show up as process name in simple 'ps' listings.

**Supported Platforms:** linux

```bash
#{exe_path} & ps
TMP=`ps | grep totally_legit`
if [ -z "${TMP}" ] ; then echo "renamed process NOT FOUND in process list" && exit 1; fi
exit 0
```

**Dependencies:**

- #{exe_path} must be exist on system.

### Atomic Test 4: Hiding a malicious process with bind mounts

Creates a malicious process and hides it by bind mounting to the /proc filesystem of a benign process

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
eval '(while true; do :; done) &'
echo $! > /tmp/evil_pid.txt
random_kernel_pid=$(ps -ef | grep "\[.*\]" | awk '{print $2}' | shuf -n 1)
sudo mount -B /proc/$random_kernel_pid /proc/$(cat /tmp/evil_pid.txt)
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Masquerade Task or Service by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1036.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Masqueraded Tasks or Services with Suspicious Naming and Execution

## Risk Assessment

| Finding                                         | Severity | Impact          |
| ----------------------------------------------- | -------- | --------------- |
| Masquerade Task or Service technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Fysbis Dr Web Analysis](https://vms.drweb.com/virus/?i=4276269)
- [Palo Alto Shamoon Nov 2016](http://researchcenter.paloaltonetworks.com/2016/11/unit42-shamoon-2-return-disttrack-wiper/)
- [Systemd Service Units](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [TechNet Schtasks](https://technet.microsoft.com/en-us/library/bb490996.aspx)
- [Atomic Red Team - T1036.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1036.004)
- [MITRE ATT&CK - T1036.004](https://attack.mitre.org/techniques/T1036/004)
