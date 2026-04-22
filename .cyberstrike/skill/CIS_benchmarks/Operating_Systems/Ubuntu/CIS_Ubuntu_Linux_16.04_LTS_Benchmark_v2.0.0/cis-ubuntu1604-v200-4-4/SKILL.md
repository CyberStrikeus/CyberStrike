---
name: cis-ubuntu1604-v200-4-4
description: "Ensure logrotate assigns appropriate permissions"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, logging, rsyslog]
cis_id: "4.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.4

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

Log files contain logged information from many services on the system, or on log hosts others as well.

## Rationale

It is important to ensure that log files have the correct permissions to ensure that sensitive data is archived and protected.

## Impact

None.

## Audit Procedure

Run the following command:

### Command Line

```bash
grep -Es "^\s*create\s+\S+" /etc/logrotate.conf /etc/logrotate.d/* | grep -E -v "\s(0)?[0-6][04]0\s"
```

## Expected Result

Nothing should be returned.

## Remediation

Edit `/etc/logrotate.conf` and update the `create` line to read 0640 or more restrictive, following local site policy.

### Command Line

Example:

```bash
# Update the create directive in /etc/logrotate.conf:
create 0640 root utmp
```

## Default Value

The default create directive varies by distribution and logrotate configuration.

## References

None.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v7               | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. |      |      |      |
