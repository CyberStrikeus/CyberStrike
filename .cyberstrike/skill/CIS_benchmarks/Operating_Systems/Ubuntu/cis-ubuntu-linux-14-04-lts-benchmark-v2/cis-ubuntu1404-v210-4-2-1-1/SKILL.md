---
name: "CIS Ubuntu 14.04 LTS - 4.2.1.1 Ensure rsyslog Service is enabled"
description: "Enable the rsyslog service to ensure system logging is active"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - rsyslog
  - logging
cis_id: "4.2.1.1"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 4.2.1.1 Ensure rsyslog Service is enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Once the `rsyslog` package is installed it needs to be activated.

## Rationale

If the `rsyslog` service is not activated the system may default to the `syslogd` service or lack logging instead.

## Audit Procedure

Verify that the `rsyslog` service is active:

```bash
initctl show-config rsyslog
```

## Expected Result

```
rsyslog
  start on filesystem
  stop on runlevel [06]
```

## Remediation

Set the proper start conditions in `/etc/init/rsyslog.conf`:

```bash
start on filesystem
```

## Default Value

rsyslog is typically enabled by default on Ubuntu 14.04.

## References

1. CIS Controls v6.1 - 6.2 Ensure Audit Log Settings Support Appropriate Log Entry Formatting

## Profile

- Level 1 - Server
- Level 1 - Workstation
