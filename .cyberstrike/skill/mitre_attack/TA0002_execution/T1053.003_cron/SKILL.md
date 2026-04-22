---
name: "T1053.003_cron"
description: "Adversaries may abuse the <code>cron</code> utility to perform task scheduling for initial or recurring execution of malicious code."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1053.003
  - execution
  - persistence
  - privilege-escalation
  - linux
  - macos
  - esxi
  - sub-technique
technique_id: "T1053.003"
tactic: "execution"
all_tactics:
  - execution
  - persistence
  - privilege-escalation
platforms:
  - Linux
  - macOS
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1053/003"
tech_stack:
  - linux
  - macos
  - esxi
cwe_ids:
  - CWE-94
chains_with:
  - T1053
  - T1053.002
  - T1053.005
  - T1053.006
  - T1053.007
prerequisites:
  - T1053
severity_boost:
  T1053: "Chain with T1053 for deeper attack path"
  T1053.002: "Chain with T1053.002 for deeper attack path"
  T1053.005: "Chain with T1053.005 for deeper attack path"
---

# T1053.003 Cron

> **Sub-technique of:** T1053

## High-Level Description

Adversaries may abuse the <code>cron</code> utility to perform task scheduling for initial or recurring execution of malicious code. The <code>cron</code> utility is a time-based job scheduler for Unix-like operating systems. The <code> crontab</code> file contains the schedule of cron entries to be run and the specified times for execution. Any <code>crontab</code> files are stored in operating system-specific file paths.

An adversary may use <code>cron</code> in Linux or Unix environments to execute programs at system startup or on a scheduled basis for Persistence. In ESXi environments, cron jobs must be created directly via the crontab file (e.g., `/var/spool/cron/crontabs/root`).

## Kill Chain Phase

- Execution (TA0002)
- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Linux, macOS, ESXi

## What to Check

- [ ] Identify if Cron technique is applicable to target environment
- [ ] Check Linux systems for indicators of Cron
- [ ] Check macOS systems for indicators of Cron
- [ ] Check ESXi systems for indicators of Cron
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Cron - Replace crontab with referenced file

This test replaces the current user's crontab file with the contents of the referenced file. This technique was used by numerous IoT automated exploitation attacks.

**Supported Platforms:** linux, macos

```bash
crontab -l > /tmp/notevil
echo "* * * * * #{command}" > #{tmp_cron} && crontab #{tmp_cron}
```

### Atomic Test 2: Cron - Add script to all cron subfolders

This test adds a script to /etc/cron.hourly, /etc/cron.daily, /etc/cron.monthly and /etc/cron.weekly folders configured to execute on a schedule. This technique was used by the threat actor Rocke during the exploitation of Linux web servers.

**Supported Platforms:** macos, linux
**Elevation Required:** Yes

```bash
echo "#{command}" > /etc/cron.daily/#{cron_script_name}
echo "#{command}" > /etc/cron.hourly/#{cron_script_name}
echo "#{command}" > /etc/cron.monthly/#{cron_script_name}
echo "#{command}" > /etc/cron.weekly/#{cron_script_name}
```

### Atomic Test 3: Cron - Add script to /etc/cron.d folder

This test adds a script to /etc/cron.d folder configured to execute on a schedule.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
echo "#{command}" > /etc/cron.d/#{cron_script_name}
```

### Atomic Test 4: Cron - Add script to /var/spool/cron/crontabs/ folder

This test adds a script to a /var/spool/cron/crontabs folder configured to execute on a schedule. This technique was used by the threat actor Rocke during the exploitation of Linux web servers.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
echo "#{command}" >> /var/spool/cron/crontabs/#{cron_script_name}
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cron by examining the target platforms (Linux, macOS, ESXi).

2. **Assess Existing Defenses**: Review whether mitigations for T1053.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1047 Audit
Review changes to the <code>cron</code> schedule. <code>cron</code> execution can be reviewed within the <code>/var/log</code> directory. To validate the location of the <code>cron</code> log file, check the syslog config at <code>/etc/rsyslog.conf</code> or <code>/etc/syslog.conf</code>.

### M1018 User Account Management
<code>cron</code> permissions are controlled by <code>/etc/cron.allow and /etc/cron.deny</code>. If there is a <code>cron.allow</code> file, then the user or users that need to use <code>cron</code> will need to be listed in the file. <code>cron.deny</code> is used to explicitly disallow users from using cron. If neither files exist, then only the super user is allowed to run cron.


## Detection

### Cross-Platform Detection of Cron Job Abuse for Persistence and Execution


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Cron technique applicable | Low | Execution |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-94 | Improper Control of Generation of Code |


## References

- [CloudSEK ESXiArgs 2023](https://www.cloudsek.com/blog/analysis-of-files-used-in-esxiargs-ransomware-attack-against-vmware-esxi-servers)
- [20 macOS Common Tools and Techniques](https://labs.sentinelone.com/20-common-tools-techniques-used-by-macos-threat-actors-malware/)
- [Atomic Red Team - T1053.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1053.003)
- [MITRE ATT&CK - T1053.003](https://attack.mitre.org/techniques/T1053/003)
