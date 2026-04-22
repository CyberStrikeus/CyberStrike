---
name: cis-ubuntu2004-v300-6-2-3-4
description: "Ensure rsyslog log file creation mode is configured"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, rsyslog]
cis_id: "6.2.3.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.3.4 Ensure rsyslog log file creation mode is configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The `$FileCreateMode` parameter allows to specify the creation mode with which `rsyslogd` creates new files.

## Rationale

It is important to ensure that log files have the correct permissions to ensure that sensitive data is archived and protected.

## Audit Procedure

### Command Line

Run the following command to verify `$FileCreateMode` to set to mode `0640` or more restrictive:

```bash
# grep ^\$FileCreateMode /etc/rsyslog.conf /etc/rsyslog.d/*.conf
```

## Expected Result

```
$FileCreateMode 0640
```

Should a site policy dictate less restrictive permissions, ensure to follow said policy. Note: More restrictive permissions such as `0600` is implicitly sufficient.

## Remediation

### Command Line

Edit either `/etc/rsyslog.conf` or a dedicated `.conf` file in `/etc/rsyslog.d/` and set `$FileCreateMode` to `0640` or more restrictive:

```
$FileCreateMode 0640
```

Reload the service:

```bash
# systemctl reload-or-restart rsyslog
```

## Default Value

Not specifically configured by default.

## References

1. RSYSLOG.CONF(5)
2. NIST SP 800-53 Rev. 5: AC-3, AC-6, MP-2
3. https://www.rsyslog.com/doc/configuration/action/rsconf1_filecreatemode.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | | | |
| v8 | 8.2 Collect Audit Logs | | | |
| v7 | 5.1 Establish Secure Configurations | | | |
| v7 | 6.2 Activate audit logging | | | |
| v7 | 6.3 Enable Detailed Logging | | | |

### MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|------------------------------|---------|-------------|
| T1070, T1070.002, T1083, T1083.000 | TA0007 | M1022 |
