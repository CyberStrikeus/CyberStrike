---
name: cis-ubuntu1604-v200-4-3
description: "Ensure logrotate is configured"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, logging, rsyslog]
cis_id: "4.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.3

## Profile
- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Manual

## Description

The system includes the capability of rotating log files regularly to avoid filling up the system with logs or making the logs unmanageably large. The file `/etc/logrotate.d/rsyslog` is the configuration file used to rotate log files created by `rsyslog`.

**Note:** If no `maxage` setting is set for logrotate a situation can occur where logrotate is interrupted and fails to delete rotated logfiles. It is recommended to set this to a value greater than the longest any log file should exist on your system to ensure that any such logfile is removed but standard rotation settings are not overridden.

## Rationale

By keeping the log files smaller and more manageable, a system administrator can easily archive these files to another system and spend less time looking through inordinately large log files.

## Impact

None.

## Audit Procedure

Review `/etc/logrotate.conf` and `/etc/logrotate.d/rsyslog` and verify logs are rotated according to site policy.

### Command Line

```bash
cat /etc/logrotate.conf
cat /etc/logrotate.d/rsyslog
```

## Expected Result

The output should show log rotation configuration that aligns with site policy, including rotation frequency, retention count, and compression settings.

## Remediation

Edit `/etc/logrotate.conf` and `/etc/logrotate.d/rsyslog` to ensure logs are rotated according to site policy.

### Command Line

```bash
# Review and edit as needed:
vi /etc/logrotate.conf
vi /etc/logrotate.d/rsyslog
```

## Default Value

logrotate is configured with default rotation settings on Ubuntu 16.04.

## References

None.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v7 | 6.4 Ensure adequate storage for logs<br/>Ensure that all systems that store logs have adequate storage space for the logs generated. | | | |
