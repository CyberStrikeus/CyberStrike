---
name: cis-ubuntu1804-v220-1-2-2
description: "Ensure filesystem integrity is regularly checked"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, aide, file-integrity, cron, systemd]
cis_id: "1.2.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.2 Ensure filesystem integrity is regularly checked (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Periodic checking of the filesystem integrity is needed to detect changes to the filesystem.

## Rationale

Periodic file checking allows the system administrator to determine on a regular basis if critical files have been changed in an unauthorized fashion.

## Audit Procedure

### Command Line

Run the following commands to verify a `cron` job scheduled to run the aide check:

```bash
grep -Prs '^([^#\n\r]+\h+)?(\/usr\/s?bin\/|^\h*)aide(\.wrapper)?\h+(--check|([^#\n\r]+\h+)?\$AIDEARGS)\b' /etc/cron.* /etc/crontab /var/spool/cron/
```

Ensure a cron job in compliance with site policy is returned.

OR

Run the following commands to verify that `aidecheck.service` and `aidecheck.timer` are enabled and `aidecheck.timer` is running:

```bash
systemctl is-enabled aidecheck.service
systemctl is-enabled aidecheck.timer
systemctl status aidecheck.timer
```

## Expected Result

A cron job or systemd timer configured to run AIDE checks regularly.

## Remediation

### Command Line

If cron will be used to schedule and run aide check:

```bash
crontab -u root -e
```

Add the following line to the crontab:

```
0 5 * * * /usr/bin/aide.wrapper --config /etc/aide/aide.conf --check
```

OR If aidecheck.service and aidecheck.timer will be used to schedule and run aide check:

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

systemd timers, timer file `aidecheck.timer` and service file `aidecheck.service`, have been included as an optional alternative to using `cron`.

Ubuntu advises using `/usr/bin/aide.wrapper` rather than calling `/usr/bin/aide` directly in order to protect the database and prevent conflicts.

## References

1. https://github.com/konstruktoid/hardening/blob/master/config/aidecheck.service
2. https://github.com/konstruktoid/hardening/blob/master/config/aidecheck.timer
3. NIST SP 800-53 Rev. 5: AU-2

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 8.5 Collect Detailed Audit Logs | | X | X |
| v7 | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data | | | X |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1036, T1036.002, T1036.003, T1036.004, T1036.005, T1565, T1565.001 | TA0040 | M1022 |
