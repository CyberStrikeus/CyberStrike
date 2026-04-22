---
name: cis-ubuntu2004-v300-6-2-1-1
description: "Ensure journald service is enabled and active"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, journald]
cis_id: "6.2.1.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.1.1 Ensure journald service is enabled and active (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Ensure that the `systemd-journald` service is enabled to allow capturing of logging events.

## Rationale

If the `systemd-journald` service is not enabled to start on boot, the system will not capture logging events.

## Audit Procedure

### Command Line

Run the following command to verify `systemd-journald` is enabled:

```bash
# systemctl is-enabled systemd-journald.service
```

Note: By default the `systemd-journald` service does not have an `[Install]` section and thus cannot be enabled / disabled. It is meant to be referenced as `Requires` or `Wants` by other unit files. As such, if the status of `systemd-journald` is not `static`, investigate why.

Run the following command to verify `systemd-journald` is active:

```bash
# systemctl is-active systemd-journald.service
```

## Expected Result

```
static
active
```

## Remediation

### Command Line

Run the following commands to unmask and start `systemd-journald.service`:

```bash
# systemctl unmask systemd-journald.service
# systemctl start systemd-journald.service
```

## Default Value

Enabled and active by default.

## References

1. NIST SP 800-53 Rev. 5: AU-2, AU-7 AU-12

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs | | | |
| v7 | 6.2 Activate audit logging | | | |
| v7 | 6.3 Enable Detailed Logging | | | |

### MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|------------------------------|---------|-------------|
| T1070, T1070.002, T1562, T1562.001 | TA0005 | M1029 |
