---
name: cis-ubuntu2004-v300-6-2-2-2
description: "Ensure journald ForwardToSyslog is disabled"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, journald]
cis_id: "6.2.2.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.2.2 Ensure journald ForwardToSyslog is disabled (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Data from `journald` should be kept in the confines of the service and not forwarded to other services.

## Rationale

- IF - `journald` is the method for capturing logs, all logs of the system should be handled by `journald` and not forwarded to other logging mechanisms.

Note: This recommendation only applies if `journald` is the chosen method for client side logging. Do not apply this recommendation if `rsyslog` is used.

## Audit Procedure

### Command Line

- IF - `journald` is the method for capturing logs

Run the following command to verify `ForwardToSyslog` is set to `no`:

```bash
# grep -Psi "^ForwardToSyslog=no" /etc/systemd/journald.conf /etc/systemd/journald.conf.d/*
```

## Expected Result

```
ForwardToSyslog=no
```

## Remediation

### Command Line

- IF - `rsyslog` is the preferred method for capturing logs, this section and Recommendation should be skipped and the "Configure rsyslog" section followed.
- IF - `journald` is the preferred method for capturing logs:

Set the following parameter in the `[Journal]` section in `/etc/systemd/journald.conf` or a file in `/etc/systemd/journald.conf.d/` ending in `.conf`:

```ini
ForwardToSyslog=no
```

Note: If this setting appears in a canonically later file, or later in the same file, the setting will be overwritten.

Run to following command to update the parameters in the service:

```bash
# systemctl reload-or-restart systemd-journald
```

## Default Value

ForwardToSyslog=no

## References

1. NIST SP 800-53 Rev. 5: AU-2, AU-6, AU-7, AU-12

## CIS Controls

| Controls Version | Control                     | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs      |      |      |      |
| v7               | 6.3 Enable Detailed Logging |      |      |      |

### MITRE ATT&CK Mappings

| Techniques / Sub-techniques        | Tactics | Mitigations |
| ---------------------------------- | ------- | ----------- |
| T1070, T1070.002, T1562, T1562.006 | TA0040  | M1029       |
