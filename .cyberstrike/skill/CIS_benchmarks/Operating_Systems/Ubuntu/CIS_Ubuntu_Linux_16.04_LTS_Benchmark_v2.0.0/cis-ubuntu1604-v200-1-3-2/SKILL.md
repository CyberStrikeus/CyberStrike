---
name: cis-ubuntu1604-v200-1-3-2
description: "Ensure filesystem integrity is regularly checked"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, aide, file-integrity, cron, systemd]
cis_id: "1.3.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.3.2

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Periodic checking of the filesystem integrity is needed to detect changes to the filesystem.

## Rationale

Periodic file checking allows the system administrator to determine on a regular basis if critical files have been changed in an unauthorized fashion.

## Audit Procedure

### Command Line

Run the following commands to verify a cron job scheduled to run the aide check:

```bash
grep -Ers '^([^#]+\s+)?(\/usr\/s?bin\/|^\s*)aide(\.wrapper)?\s(--check|\$AIDEARGS)\b' /etc/cron.* /etc/crontab /var/spool/cron/
```

Ensure a cron job in compliance with site policy is returned.

**OR** Run the following commands to verify that aidecheck.service and aidecheck.timer are enabled and aidecheck.timer is running:

```bash
systemctl is-enabled aidecheck.service
```

```bash
systemctl is-enabled aidecheck.timer
systemctl status aidecheck.timer
```

## Expected Result

A cron job or systemd timer should be configured to run AIDE checks regularly.

## Remediation

### Command Line

If cron will be used to schedule and run aide check, run the following command:

```bash
crontab -u root -e
```

Add the following line to the crontab:

```
0 5 * * * /usr/bin/aide.wrapper --config /etc/aide/aide.conf --check
```

**OR** If aidecheck.service and aidecheck.timer will be used to schedule and run aide check:

Create or edit the file `/etc/systemd/system/aidecheck.service` and add the following lines:

```
[Unit]
Description=Aide Check

[Service]
Type=simple
ExecStart=/usr/bin/aide.wrapper --config /etc/aide/aide.conf --check

[Install]
WantedBy=multi-user.target
```

Create or edit the file `/etc/systemd/system/aidecheck.timer` and add the following lines:

```
[Unit]
Description=Aide check every day at 5AM

[Timer]
OnCalendar=*-*-* 05:00:00
Unit=aidecheck.service

[Install]
WantedBy=multi-user.target
```

Run the following commands:

```bash
chown root:root /etc/systemd/system/aidecheck.*
chmod 0644 /etc/systemd/system/aidecheck.*
systemctl daemon-reload
systemctl enable aidecheck.service
systemctl --now enable aidecheck.timer
```

## Additional Information

The checking in this recommendation occurs every day at 5am. Alter the frequency and time of the checks in compliance with site policy.

systemd timers, timer file `aidecheck.timer` and service file `aidecheck.service`, have been included as an optional alternative to using cron.

Ubuntu advises using `/usr/bin/aide.wrapper` rather than calling `/usr/bin/aide` directly in order to protect the database and prevent conflicts.

## Default Value

Not configured by default.

## References

1. https://github.com/konstruktoid/hardening/blob/master/config/aidecheck.service
2. https://github.com/konstruktoid/hardening/blob/master/config/aidecheck.timer

## CIS Controls

| Controls Version | Control                                                             |
| ---------------- | ------------------------------------------------------------------- |
| v7               | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data |

## Assessment Status

Automated
