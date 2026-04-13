---
name: cis-apache-6.2
description: "Ensure a Syslog Facility Is Configured for Error Logging"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, logging, monitoring]
cis_id: "6.2"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure a Syslog Facility Is Configured for Error Logging

## Description

The `ErrorLog` directive should be configured to send web server error logs to a `syslog` facility so the logs can be processed and monitored along with the system logs.

## Rationale

It is easy for web server error logs to be overlooked in the log monitoring process, and yet the application-level attacks have become the most common and are extremely important for detecting attacks early, as well as detecting non-malicious problems such as a broken link, or internal errors. By including the Apache error logs with the system logging facility, the application logs are more likely to be included in the established log monitoring process.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

1. Verify that the `ErrorLog` in the Apache server configuration has a value of `syslog:facility`, where `facility` can be any of the `syslog` facility values such as `local1`.
2. Verify there is a similar `ErrorLog` directive which is either configured or inherited for each virtual host.

## Remediation

Perform the following to implement the recommended state:

1. Add an `ErrorLog` directive if not already configured. Any appropriate `syslog` facility may be used in place of `local1`.

```
ErrorLog "syslog:local1"
```

2. Add a similar `ErrorLog` directive for each virtual host if necessary.

## Default Value

The following is the default configuration:

```
ErrorLog "logs/error_log"
```

## References

1. https://httpd.apache.org/docs/2.2/logs.html
2. https://httpd.apache.org/docs/2.2/mod/core.html#loglevel
3. https://httpd.apache.org/docs/2.2/mod/core.html#errorlog

## CIS Controls

**Version 6**

6.6 Deploy A SIEM OR Log Analysis Tools For Aggregation And Correlation /Analysis
Deploy a SIEM (Security Information and Event Management) or log analytic tools for log aggregation and consolidation from multiple machines and for log correlation and analysis. Using the SIEM tool, system administrators and security personnel should devise profiles of common events from given systems so that they can tune detection to focus on unusual activity, avoid false positives, more rapidly identify anomalies, and prevent overwhelming analysts with insignificant alerts.

**Version 7**

6.6 Deploy SIEM or Log Analytic tool
Deploy Security Information and Event Management (SIEM) or log analytic tool for log correlation and analysis.

6.8 Regularly Tune SIEM
On a regular basis, tune your SIEM system to better identify actionable events and decrease event noise.

## Profile

Level 2 | Scored
