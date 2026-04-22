---
name: cis-ubuntu2004-v300-6-2-3-3
description: "Ensure journald is configured to send logs to rsyslog"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, rsyslog]
cis_id: "6.2.3.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.3.3 Ensure journald is configured to send logs to rsyslog (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Data from `systemd-journald` may be stored in volatile memory or persisted locally on the server. Utilities exist to accept remote export of `systemd-journald` logs, however, use of the `rsyslog` service provides a consistent means of log collection and export.

## Rationale

- IF - `rsyslog` is the preferred method for capturing logs, all logs of the system should be sent to it for further processing.

Note: This recommendation only applies if `rsyslog` is the chosen method for client side logging. Do not apply this recommendation if `systemd-journald` is used.

## Audit Procedure

### Command Line

- IF - `rsyslog` is the preferred method for capturing logs

Run the following command to verify `systemd-journald.service` and `rsyslog.service` are loaded and active:

```bash
# systemctl list-units --type service | grep -P -- '(journald|rsyslog)'
```

Output should be similar to:

```
rsyslog.service                loaded active running System Logging Service
systemd-journald.service       loaded active running Journal Service
```

Run the following command to verify that logs are forwarded to `rsyslog` by setting `ForwardToSyslog` to `yes` in the systemd-journald configuration:

```bash
# grep -Psi "^ForwardToSyslog=yes" /etc/systemd/journal.conf /etc/systemd/journald.conf.d/*
```

## Expected Result

```
ForwardToSyslog=yes
```

## Remediation

### Command Line

- IF - `Journald` is the preferred method for capturing logs, this section and Recommendation should be skipped and the "Configure Journald" section followed.
- IF - `rsyslog` is the preferred method for capturing logs:

Set the following parameter in the `[Journal]` section in `/etc/systemd/journald.conf` or a file in `/etc/systemd/journald.conf.d/` ending in `.conf`:

```ini
ForwardToSyslog=yes
```

Note: If this setting appears in a canonically later file, or later in the same file, the setting will be overwritten.

Run to following command to update the parameters in the service:
Restart `systemd-journald.service`:

```bash
# systemctl reload-or-restart systemd-journald.service
```

## Default Value

ForwardToSyslog=no

## References

1. NIST SP 800-53 Rev. 5: AC-3, AU-2, AU-4, AU-12, MP-2
2. SYSTEMD-JOURNALD.SERVICE(8)
3. JOURNALD.CONF(5)

## CIS Controls

| Controls Version | Control                     | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs      |      |      |      |
| v8               | 8.9 Centralize Audit Logs   |      |      |      |
| v7               | 6.2 Activate audit logging  |      |      |      |
| v7               | 6.3 Enable Detailed Logging |      |      |      |
| v7               | 6.5 Central Log Management  |      |      |      |

### MITRE ATT&CK Mappings

| Techniques / Sub-techniques               | Tactics | Mitigations |
| ----------------------------------------- | ------- | ----------- |
| T1070, T1070.002, T1562, T1562.006, T1565 | TA0040  | M1029       |
