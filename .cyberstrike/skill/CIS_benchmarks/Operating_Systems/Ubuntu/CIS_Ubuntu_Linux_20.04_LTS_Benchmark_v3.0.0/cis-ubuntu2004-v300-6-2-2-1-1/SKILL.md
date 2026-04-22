---
name: cis-ubuntu2004-v300-6-2-2-1-1
description: "Ensure systemd-journal-remote is installed"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, journald]
cis_id: "6.2.2.1.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.2.1.1 Ensure systemd-journal-remote is installed (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Journald `systemd-journal-remote` supports the ability to send log events it gathers to a remote log host or to receive messages from remote hosts, thus enabling centralized log management.

## Rationale

Storing log data on a remote host protects log integrity from local attacks. If an attacker gains root access on the local system, they could tamper with or remove log data that is stored on the local system.

Note: This recommendation only applies if `journald` is the chosen method for client side logging. Do not apply this recommendation if `rsyslog` is used.

## Audit Procedure

### Command Line

- IF - `journald` will be used for logging on the system:

Run the following command to verify `systemd-journal-remote` is installed.

```bash
# dpkg-query -s systemd-journal-remote &>/dev/null && echo "systemd-journal-remote is installed"
```

## Expected Result

```
systemd-journal-remote is installed
```

## Remediation

### Command Line

Run the following command to install `systemd-journal-remote`:

```bash
# apt install systemd-journal-remote
```

## Default Value

Not installed by default.

## References

1. NIST SP 800-53 Rev. 5: AU-2, AU-7 AU-12

## CIS Controls

| Controls Version | Control                     | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs      |      |      |      |
| v7               | 6.2 Activate audit logging  |      |      |      |
| v7               | 6.3 Enable Detailed Logging |      |      |      |

### MITRE ATT&CK Mappings

| Techniques / Sub-techniques        | Tactics | Mitigations |
| ---------------------------------- | ------- | ----------- |
| T1070, T1070.002, T1562, T1562.006 | TA0040  | M1029       |
