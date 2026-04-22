---
name: "T1053.002_at"
description: "Adversaries may abuse the at utility to perform task scheduling for initial or recurring execution of malicious code."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1053.002
  - execution
  - persistence
  - privilege-escalation
  - windows
  - linux
  - macos
  - sub-technique
technique_id: "T1053.002"
tactic: "execution"
all_tactics:
  - execution
  - persistence
  - privilege-escalation
platforms:
  - Windows
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1053/002"
tech_stack:
  - windows
  - linux
  - macos
cwe_ids:
  - CWE-94
chains_with:
  - T1053
  - T1053.003
  - T1053.005
  - T1053.006
  - T1053.007
prerequisites:
  - T1053
severity_boost:
  T1053: "Chain with T1053 for deeper attack path"
  T1053.003: "Chain with T1053.003 for deeper attack path"
  T1053.005: "Chain with T1053.005 for deeper attack path"
---

# T1053.002 At

> **Sub-technique of:** T1053

## High-Level Description

Adversaries may abuse the at utility to perform task scheduling for initial or recurring execution of malicious code. The at utility exists as an executable within Windows, Linux, and macOS for scheduling tasks at a specified time and date. Although deprecated in favor of Scheduled Task's schtasks in Windows environments, using at requires that the Task Scheduler service be running, and the user to be logged on as a member of the local Administrators group. In addition to explicitly running the `at` command, adversaries may also schedule a task with at by directly leveraging the Windows Management Instrumentation `Win32_ScheduledJob` WMI class.

On Linux and macOS, at may be invoked by the superuser as well as any users added to the <code>at.allow</code> file. If the <code>at.allow</code> file does not exist, the <code>at.deny</code> file is checked. Every username not listed in <code>at.deny</code> is allowed to invoke at. If the <code>at.deny</code> exists and is empty, global use of at is permitted. If neither file exists (which is often the baseline) only the superuser is allowed to use at.

Adversaries may use at to execute programs at system startup or on a scheduled basis for Persistence. at can also be abused to conduct remote Execution as part of Lateral Movement and/or to run a process under the context of a specified account (such as SYSTEM).

In Linux environments, adversaries may also abuse at to break out of restricted environments by using a task to spawn an interactive system shell or to run system commands. Similarly, at may also be used for Privilege Escalation if the binary is allowed to run as superuser via <code>sudo</code>.

## Kill Chain Phase

- Execution (TA0002)
- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows, Linux, macOS

## What to Check

- [ ] Identify if At technique is applicable to target environment
- [ ] Check Windows systems for indicators of At
- [ ] Check Linux systems for indicators of At
- [ ] Check macOS systems for indicators of At
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: At.exe Scheduled task

Executes cmd.exe
Note: deprecated in Windows 8+

Upon successful execution, cmd.exe will spawn at.exe and create a scheduled task that will spawn cmd at a specific time.

**Supported Platforms:** windows

```cmd
at 13:20 /interactive cmd
```

### Atomic Test 2: At - Schedule a job

This test submits a command to be run in the future by the `at` daemon.

**Supported Platforms:** linux

```bash
echo "#{at_command}" | at #{time_spec}
```

**Dependencies:**

- The `at` and `atd` executables must exist in the PATH
- The `atd` daemon must be running

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to At by examining the target platforms (Windows, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1053.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1028 Operating System Configuration

Configure settings for scheduled tasks to force tasks to run under the context of the authenticated account instead of allowing them to run as SYSTEM. The associated Registry key is located at <code>HKLM\SYSTEM\CurrentControlSet\Control\Lsa\SubmitControl</code>. The setting can be configured through GPO: Computer Configuration > [Policies] > Windows Settings > Security Settings > Local Policies > Security Options: Domain Controller: Allow server operators to schedule tasks, set to disabled.

### M1047 Audit

Toolkits like the PowerSploit framework contain PowerUp modules that can be used to explore systems for permission weaknesses in scheduled tasks that could be used to escalate privileges. Windows operating system also creates a registry key specifically associated with the creation of a scheduled task on the destination host at: Microsoft\Windows NT\CurrentVersion\Schedule\TaskCache\Tree\At1. In Linux and macOS environments, scheduled tasks using <code>at</code> can be audited locally, or through centrally collected logging, using syslog, or auditd events from the host.

### M1018 User Account Management

Limit privileges of user accounts and remediate Privilege Escalation vectors so only authorized administrators can create scheduled tasks on remote systems. In Linux environments, users account-level access to <code>at</code> can be managed using <code>at.allow</code> and <code>at.deny</code> files. Users listed in the at.allow are enabled to schedule actions using at, whereas users listed in at.deny file disabled from the utility.

### M1026 Privileged Account Management

Configure the Increase Scheduling Priority option to only allow the Administrators group the rights to schedule a priority process. This can be configured through GPO: Computer Configuration > [Policies] > Windows Settings > Security Settings > Local Policies > User Rights Assignment: Increase scheduling priority.

## Detection

### Cross-Platform Detection of Scheduled Task/Job Abuse via `at` Utility

## Risk Assessment

| Finding                 | Severity | Impact    |
| ----------------------- | -------- | --------- |
| At technique applicable | High     | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [rowland linux at 2019](https://www.linkedin.com/pulse/getting-attacker-ip-address-from-malicious-linux-job-craig-rowland/)
- [GTFObins at](https://gtfobins.github.io/gtfobins/at/)
- [Linux at](https://man7.org/linux/man-pages/man1/at.1p.html)
- [Twitter Leoloobeek Scheduled Task](https://x.com/leoloobeek/status/939248813465853953)
- [Microsoft Scheduled Task Events Win10](https://docs.microsoft.com/en-us/windows/security/threat-protection/auditing/audit-other-object-access-events)
- [TechNet Scheduled Task Events](https://technet.microsoft.com/library/dd315590.aspx)
- [Malicious Life by Cybereason](https://www.cybereason.com/blog/wmi-lateral-movement-win32#blog-subscribe)
- [TechNet Autoruns](https://technet.microsoft.com/en-us/sysinternals/bb963902)
- [TechNet Forum Scheduled Task Operational Setting](https://social.technet.microsoft.com/Forums/en-US/e5bca729-52e7-4fcb-ba12-3225c564674c/scheduled-tasks-history-retention-settings?forum=winserver8gen)
- [Atomic Red Team - T1053.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1053.002)
- [MITRE ATT&CK - T1053.002](https://attack.mitre.org/techniques/T1053/002)
