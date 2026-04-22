---
name: cis-ubuntu1604-v200-4-2-1-1
description: "Ensure rsyslog is installed"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, logging, rsyslog]
cis_id: "4.2.1.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.2.1.1

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

The `rsyslog` software is a recommended replacement to the original `syslogd` daemon which provide improvements over `syslogd`, such as connection-oriented (i.e. TCP) transmission of logs, the option to log to database formats, and the encryption of log data en route to a central logging server.

## Rationale

The security enhancements of `rsyslog` such as connection-oriented (i.e. TCP) transmission of logs, the option to log to database formats, and the encryption of log data en route to a central logging server) justify installing and configuring the package.

## Impact

None.

## Audit Procedure

Verify either rsyslog or syslog-ng is installed. Use the following command to provide the needed information:

### Command Line

```bash
dpkg -s rsyslog
```

## Expected Result

The command should return package information indicating rsyslog is installed.

## Remediation

Install rsyslog:

### Command Line

```bash
apt install rsyslog
```

## Default Value

rsyslog is installed by default on Ubuntu 16.04.

## References

None.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v7               | 6.2 Activate audit logging<br/>Ensure that local logging has been enabled on all systems and networking devices.                                                                                          |      |      |      |
| v7               | 6.3 Enable Detailed Logging<br/>Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |      |      |      |
