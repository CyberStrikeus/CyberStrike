---
name: cis-ubuntu2004-v300-6-2-2-3
description: "Ensure journald Compress is configured"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, journald]
cis_id: "6.2.2.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.2.3 Ensure journald Compress is configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The journald system includes the capability of compressing overly large files to avoid filling up the system with logs or making the logs unmanageably large.

## Rationale

Uncompressed large files may unexpectedly fill a filesystem leading to resource unavailability. Compressing logs prior to write can prevent sudden, unexpected filesystem impacts.

Note: This recommendation only applies if `journald` is the chosen method for client side logging. Do not apply this recommendation if `rsyslog` is used.

## Audit Procedure

### Command Line

- IF - `journald` is the method for capturing logs

Run the following command to verify `Compress` is set to `yes`:

```bash
# grep -Psi "^Compress=yes" /etc/systemd/journald.conf /etc/systemd/journald.conf.d/*
```

## Expected Result

```
Compress=yes
```

## Remediation

### Command Line

- IF - `rsyslog` is the preferred method for capturing logs, this section and Recommendation should be skipped and the "Configure rsyslog" section followed.
- IF - `journald` is the preferred method for capturing logs:

Set the following parameter in the `[Journal]` section in `/etc/systemd/journald.conf` or a file in `/etc/systemd/journald.conf.d/` ending in `.conf`:

```ini
Compress=yes
```

Note: If this setting appears in a canonically later file, or later in the same file, the setting will be overwritten.

Run to following command to update the parameters in the service:

```bash
# systemctl reload-or-restart systemd-journald
```

## Default Value

Compress=yes

## References

1. NIST SP 800-53 Rev. 5: AU-4

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs | | | |
| v8 | 8.3 Ensure Adequate Audit Log Storage | | | |
| v7 | 6.2 Activate audit logging | | | |
| v7 | 6.3 Enable Detailed Logging | | | |
| v7 | 6.4 Ensure adequate storage for logs | | | |

### MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|------------------------------|---------|-------------|
| T1562, T1562.001 | TA0040 | M1053 |
