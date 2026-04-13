---
name: cis-apache24-6.2
description: "Ensure a Syslog Facility Is Configured for Error Logging"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, logging, monitoring, maintenance]
cis_id: "6.2"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure a Syslog Facility Is Configured for Error Logging (Manual)

## Profile Applicability

Level 2

## Description

The `ErrorLog` directive should be configured to send logs to a `syslog` facility so that the logs can be processed and monitored along with the system logs.

## Rationale

It is easy for the web server error logs to be overlooked in the log monitoring process, and yet the application level attacks have become the most common and are extremely important for detecting attacks early, as well as detecting non-malicious problems such as a broken link, or internal errors. By including the Apache error logs with the system logging facility, the application logs are more likely to be included in the established log monitoring process.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

1. Verify that the `ErrorLog` in the Apache server configuration has a value of `syslog:facility` where `facility` can be any of the `syslog` facility values such as `local1`.

2. Verify there is a similar `ErrorLog` directive which is either configured or inherited for each virtual host.

## Remediation

Perform the following to implement the recommended state:

1. Add an ErrorLog directive if not already configured. Any appropriate syslog facility may be used in place of `local1`.
   ```
   ErrorLog "syslog:local1"
   ```

2. Add a similar ErrorLog directive for each virtual host if necessary.

## Default Value

The following is the default configuration:

```
ErrorLog "logs/error_log"
```

## References

1. https://httpd.apache.org/docs/2.4/logs.html
2. https://httpd.apache.org/docs/2.4/mod/core.html#loglevel
3. https://httpd.apache.org/docs/2.4/mod/core.html#errorlog

## CIS Controls

**v8:**
- 8.2 Collect Audit Logs
  - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets.

**v7:**
- 6.6 Deploy SIEM or Log Analytic tool
  - Deploy Security Information and Event Management (SIEM) or log analytic tool for log correlation and analysis.

- 6.8 Regularly Tune SIEM
  - On a regular basis, tune your SIEM system to better identify actionable events and decrease event noise.
