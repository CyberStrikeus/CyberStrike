---
name: cis-ubuntu1804-v220-5-1-1-5
description: "Ensure journald is not configured to send logs to rsyslog"
category: cis-logging
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, journald, logging]
cis_id: "5.1.1.5"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.1.5 Ensure journald is not configured to send logs to rsyslog (Manual)

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Manual

## Description

Data from `journald` should be kept in the confines of the service and not forwarded on to other services.

## Rationale

IF journald is the method for capturing logs, all logs of the system should be handled by journald and not forwarded to other logging mechanisms.

## Audit Procedure

### Command Line

IF journald is the method for capturing logs, run the following command to verify that logs are not forwarded to `rsyslog`:

```bash
grep -Psi '^\h*ForwardToSyslog\h*=\h*yes\b' /etc/systemd/journald.conf /etc/systemd/journald.conf.d/*
```

Verify that there is no output.

## Expected Result

No output should be returned.

## Remediation

### Command Line

Edit the `/etc/systemd/journald.conf` file and files in `/etc/systemd/journald.conf.d/` and ensure that `ForwardToSyslog=yes` is removed.

Restart the service:

```bash
systemctl restart systemd-journald
```

## Default Value

ForwardToSyslog is not set by default.

## References

1. NIST SP 800-53 Rev. 5: AU-2, AU-6, AU-7, AU-12

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v8 | 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets. |
| v8 | 8.9 Centralize Audit Logs - Centralize, to the extent possible, audit log collection and retention across enterprise assets. |
| v7 | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices. |
| v7 | 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |
| v7 | 6.5 Central Log Management - Ensure that appropriate logs are being aggregated to a central log management system for analysis and review. |
