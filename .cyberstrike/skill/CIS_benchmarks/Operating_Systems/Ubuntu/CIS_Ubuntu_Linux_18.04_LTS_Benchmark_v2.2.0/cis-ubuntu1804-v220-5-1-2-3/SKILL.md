---
name: cis-ubuntu1804-v220-5-1-2-3
description: "Ensure journald is configured to send logs to rsyslog"
category: cis-logging
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, rsyslog, journald, logging]
cis_id: "5.1.2.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.2.3 Ensure journald is configured to send logs to rsyslog (Manual)

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Manual

## Description

Data from `journald` may be stored in volatile memory or persisted locally on the server. Utilities exist to accept remote export of `journald` logs, however, use of the RSyslog service provides a consistent means of log collection and export.

## Rationale

IF RSyslog is the preferred method for capturing logs, all logs of the system should be sent to it for further processing.

## Audit Procedure

### Command Line

IF RSyslog is the preferred method for capturing logs, review `/etc/systemd/journald.conf` and verify that logs are forwarded to `rsyslog`:

```bash
grep ^\s*ForwardToSyslog /etc/systemd/journald.conf
```

Verify the output matches:

```
ForwardToSyslog=yes
```

## Expected Result

The output should show `ForwardToSyslog=yes`.

## Remediation

### Command Line

Edit the `/etc/systemd/journald.conf` file and add the following line:

```
ForwardToSyslog=yes
```

Restart the service:

```bash
systemctl restart rsyslog
```

## Default Value

ForwardToSyslog is not set by default.

## References

1. NIST SP 800-53 Rev. 5: AU-9

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v8 | 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets. |
| v8 | 8.9 Centralize Audit Logs - Centralize, to the extent possible, audit log collection and retention across enterprise assets. |
| v7 | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices. |
| v7 | 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |
| v7 | 6.5 Central Log Management - Ensure that appropriate logs are being aggregated to a central log management system for analysis and review. |
