---
name: cis-apache24-6.3
description: "Ensure the Server Access Log Is Configured Correctly"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, logging, monitoring, maintenance]
cis_id: "6.3"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Server Access Log Is Configured Correctly (Manual)

## Profile Applicability

Level 1

## Description

The LogFormat directive defines a nickname for a log format and information to be included in the access log entries. The CustomLog directive specifies the log file, syslog facility or piped logging utility.

## Rationale

The server access logs are also invaluable for a variety of reasons. They can be used to determine what resources are being used most. Most importantly, they can be used to investigate anomalous behavior that may be an indication that an attack is pending or has occurred.

## Impact

Access logs configured correctly.

## Audit Procedure

Verify the CustomLog directive is configured to an appropriate log file using combined format including tokens: %h %l %u %t %r %>s %b %{Referer}i %{User-agent}i

## Remediation

Add or modify LogFormat and CustomLog directives to use combined format with appropriate log destination.

## Default Value

LogFormat combined, CustomLog common

## References

1. https://httpd.apache.org/docs/2.4/mod/mod_log_config.html#customlog
2. https://httpd.apache.org/docs/2.4/mod/mod_log_config.html#formats

## CIS Controls

v8: 8.2 Collect Audit Logs
v7: 6.2 Activate audit logging, 6.3 Enable Detailed Logging
