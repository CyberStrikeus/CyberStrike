---
name: "CIS Ubuntu 14.04 LTS - 4.2.2.1 Ensure syslog-ng service is enabled"
description: "Enable the syslog-ng service to ensure system logging is active"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - syslog-ng
  - logging
cis_id: "4.2.2.1"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 4.2.2.1 Ensure syslog-ng service is enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Once the `syslog-ng` package is installed it needs to be activated.

## Rationale

If the `syslog-ng` service is not activated the system may default to the `syslogd` service or lack logging instead.

## Audit Procedure

Run the following to ensure proper start links for `syslog-ng` exist in `/etc/rc*.d`:

```bash
ls /etc/rc*.d/S*syslog-ng
```

## Expected Result

```
/etc/rc2.d/S10syslog-ng  /etc/rc3.d/S10syslog-ng  /etc/rc4.d/S10syslog-ng
/etc/rc5.d/S10syslog-ng
```

Start links should exist for run levels 2, 3, 4, and 5.

## Remediation

Run the following command to enable `syslog-ng`:

```bash
update-rc.d syslog-ng enable
```

## Default Value

syslog-ng is not installed by default on Ubuntu 14.04.

## References

1. CIS Controls v6.1 - 6.2 Ensure Audit Log Settings Support Appropriate Log Entry Formatting

## Profile

- Level 1 - Server
- Level 1 - Workstation
