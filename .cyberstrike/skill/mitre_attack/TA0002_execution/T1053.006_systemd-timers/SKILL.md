---
name: "T1053.006_systemd-timers"
description: "Adversaries may abuse systemd timers to perform task scheduling for initial or recurring execution of malicious code."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1053.006
  - execution
  - persistence
  - privilege-escalation
  - linux
  - sub-technique
technique_id: "T1053.006"
tactic: "execution"
all_tactics:
  - execution
  - persistence
  - privilege-escalation
platforms:
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1053/006"
tech_stack:
  - linux
cwe_ids:
  - CWE-94
chains_with:
  - T1053
  - T1053.002
  - T1053.003
  - T1053.005
  - T1053.007
prerequisites:
  - T1053
severity_boost:
  T1053: "Chain with T1053 for deeper attack path"
  T1053.002: "Chain with T1053.002 for deeper attack path"
  T1053.003: "Chain with T1053.003 for deeper attack path"
---

# T1053.006 Systemd Timers

> **Sub-technique of:** T1053

## High-Level Description

Adversaries may abuse systemd timers to perform task scheduling for initial or recurring execution of malicious code. Systemd timers are unit files with file extension <code>.timer</code> that control services. Timers can be set to run on a calendar event or after a time span relative to a starting point. They can be used as an alternative to Cron in Linux environments. Systemd timers may be activated remotely via the <code>systemctl</code> command line utility, which operates over SSH.

Each <code>.timer</code> file must have a corresponding <code>.service</code> file with the same name, e.g., <code>example.timer</code> and <code>example.service</code>. <code>.service</code> files are Systemd Service unit files that are managed by the systemd system and service manager. Privileged timers are written to <code>/etc/systemd/system/</code> and <code>/usr/lib/systemd/system</code> while user level are written to <code>~/.config/systemd/user/</code>.

An adversary may use systemd timers to execute malicious code at system startup or on a scheduled basis for persistence. Timers installed using privileged paths may be used to maintain root level persistence. Adversaries may also install user level timers to achieve user level persistence.

## Kill Chain Phase

- Execution (TA0002)
- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Linux

## What to Check

- [ ] Identify if Systemd Timers technique is applicable to target environment
- [ ] Check Linux systems for indicators of Systemd Timers
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Create Systemd Service and Timer

This test creates Systemd service and timer then starts and enables the Systemd timer

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
echo "[Unit]" > #{path_to_systemd_service}
echo "Description=Atomic Red Team Systemd Timer Service" >> #{path_to_systemd_service}
echo "[Service]" >> #{path_to_systemd_service}
echo "Type=simple" >> #{path_to_systemd_service}
echo "ExecStart=/bin/touch /tmp/art-systemd-timer-marker" >> #{path_to_systemd_service}
echo "[Install]" >> #{path_to_systemd_service}
echo "WantedBy=multi-user.target" >> #{path_to_systemd_service}
echo "[Unit]" > #{path_to_systemd_timer}
echo "Description=Executes Atomic Red Team Systemd Timer Service" >> #{path_to_systemd_timer}
echo "Requires=#{systemd_service_name}" >> #{path_to_systemd_timer}
echo "[Timer]" >> #{path_to_systemd_timer}
echo "Unit=#{systemd_service_name}" >> #{path_to_systemd_timer}
echo "OnCalendar=*-*-* *:*:00" >> #{path_to_systemd_timer}
echo "[Install]" >> #{path_to_systemd_timer}
echo "WantedBy=timers.target" >> #{path_to_systemd_timer}
systemctl start #{systemd_timer_name}
systemctl enable #{systemd_timer_name}
systemctl daemon-reload
```

### Atomic Test 2: Create a user level transient systemd service and timer

Schedule a user level transient task (will not survive a reboot) without having to create the .timer or .service files by using the systemd-run command.

**Supported Platforms:** linux

```bash
systemd-run --user --unit=Atomic-Red-Team --on-calendar '*:0/1' /bin/sh -c 'echo "$(date) $(whoami)" >>/tmp/log'
```

**Dependencies:**
- Check if systemd-run exists on the machine

### Atomic Test 3: Create a system level transient systemd service and timer

Schedule a system level transient task (will not survive a reboot) without having to create the .timer or .service files by using the systemd-run command.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
systemd-run --unit=Atomic-Red-Team --on-calendar '*:0/1' /bin/sh -c 'echo "$(date) $(whoami)" >>/tmp/log'
```

**Dependencies:**
- Check if systemd-run exists on the machine


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Systemd Timers by examining the target platforms (Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1053.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1022 Restrict File and Directory Permissions
Restrict read/write access to systemd <code>.timer</code> unit files to only select privileged users who have a legitimate need to manage system services.

### M1018 User Account Management
Limit user access to system utilities such as 'systemctl' or 'systemd-run' to users who have a legitimate need.

### M1026 Privileged Account Management
Limit access to the root account and prevent users from creating and/or modifying systemd timer unit files.


## Detection

### Behavioral Detection of Systemd Timer Abuse for Scheduled Execution


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Systemd Timers technique applicable | High | Execution |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-94 | Improper Control of Generation of Code |


## References

- [Systemd Remote Control](https://www.tecmint.com/control-systemd-services-on-remote-linux-server/)
- [archlinux Systemd Timers Aug 2020](https://wiki.archlinux.org/index.php/Systemd/Timers)
- [gist Arch package compromise 10JUL2018](https://gist.github.com/campuscodi/74d0d2e35d8fd9499c76333ce027345a)
- [Arch Linux Package Systemd Compromise BleepingComputer 10JUL2018](https://www.bleepingcomputer.com/news/security/malware-found-in-arch-linux-aur-package-repository/)
- [acroread package compromised Arch Linux Mail 8JUL2018](https://lists.archlinux.org/pipermail/aur-general/2018-July/034153.html)
- [Falcon Sandbox smp: 28553b3a9d](https://www.hybrid-analysis.com/sample/28553b3a9d2ad4361d33d29ac4bf771d008e0073cec01b5561c6348a608f8dd7?environmentId=300)
- [Linux man-pages: systemd January 2014](http://man7.org/linux/man-pages/man1/systemd.1.html)
- [Atomic Red Team - T1053.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1053.006)
- [MITRE ATT&CK - T1053.006](https://attack.mitre.org/techniques/T1053/006)
