---
name: cis-ubuntu1604-v200-4-1-8
description: "Ensure session initiation information is collected"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, auditd, logging]
cis_id: "4.1.8"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.1.8

## Profile
- **Level:** 2 - Server
- **Level:** 2 - Workstation
- **Assessment Status:** Automated

## Description

Monitor session initiation events. The parameters in this section track changes to the files associated with session events. The file /var/run/utmp tracks all currently logged in users. All audit records will be tagged with the identifier "session." The /var/log/wtmp file tracks logins, logouts, shutdown, and reboot events. The file /var/log/btmp keeps track of failed login attempts and can be read by entering the command /usr/bin/last -f /var/log/btmp. All audit records will be tagged with the identifier "logins."

**Note:**
- The last command can be used to read /var/log/wtmp (last with no parameters) and /var/run/utmp (last -f /var/run/utmp)
- Reloading the auditd config to set active settings requires the auditd service to be restarted, and may require a system reboot.

## Rationale

Monitoring these files for changes could alert a system administrator to logins occurring at unusual hours, which could indicate intruder activity (i.e. a user logging in at a time when they do not normally log in).

## Impact

None.

## Audit Procedure

### Command Line

Run the following command to verify the rules are contained in a `.rules` file in the `/etc/audit/rules.d/` directory:

```bash
grep -E '(session|logins)' /etc/audit/rules.d/*.rules
```

Verify output includes:

```
-w /var/run/utmp -p wa -k session
-w /var/log/wtmp -p wa -k logins
-w /var/log/btmp -p wa -k logins
```

Run the following command to verify that rules are in the running auditd config:

```bash
auditctl -l | grep -E '(session|logins)'
```

Verify output includes:

```
-w /var/run/utmp -p wa -k session
-w /var/log/wtmp -p wa -k logins
-w /var/log/btmp -p wa -k logins
```

## Expected Result

Output should include the rules listed above.

## Remediation

### Command Line

Edit or create a file in the `/etc/audit/rules.d/` directory ending in `.rules`.

Example: `vi /etc/audit/rules.d/50-session.rules`

Add the following lines:

```bash
-w /var/run/utmp -p wa -k session
-w /var/log/wtmp -p wa -k logins
-w /var/log/btmp -p wa -k logins
```

## Default Value

By default, no audit rules are configured for session initiation events.

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Section 4.1.8

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 4.9 Log and Alert on Unsuccessful Administrative Account Login - Configure systems to issue a log entry and alert on unsuccessful logins to an administrative account. |
| v7 | 16.11 Lock Workstation Sessions After Inactivity - Automatically lock workstation sessions after a standard period of inactivity. |
| v7 | 16.13 Alert on Account Login Behavior Deviation - Alert when users deviate from normal login behavior, such as time-of-day, workstation location and duration. |
