---
name: cis-ubuntu1204-v110-8-2-1
description: "Install the rsyslog package"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, rsyslog, syslog, package]
cis_id: "8.2.1"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.2.1 Install the rsyslog package (Scored)

## Profile Applicability
- Level 1

## Description
The `rsyslog` package is a third party package that provides many enhancements to syslog, such as multi-threading, TCP communication, message filtering and data base support.

## Rationale
The security enhancements of rsyslog such as connection-oriented (i.e. TCP) transmission of logs, the option to log to database formats, and the encryption of log data en route to a central logging server) justify installing and configuring the package.

## Audit Procedure
### Using Command Line
Ensure `rsyslog` is installed:
```bash
dpkg -s rsyslog
```

## Expected Result
Ensure package status is `installed ok installed`.

## Remediation
### Using Command Line
Install the `rsyslog` package:
```bash
apt-get install rsyslog
```

## Default Value
rsyslog is not installed by default on all Ubuntu 12.04 installations.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
