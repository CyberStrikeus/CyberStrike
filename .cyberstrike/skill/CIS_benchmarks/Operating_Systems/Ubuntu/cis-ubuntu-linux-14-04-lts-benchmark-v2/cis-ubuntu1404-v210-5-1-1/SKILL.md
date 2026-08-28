---
name: "CIS Ubuntu 14.04 LTS - 5.1.1 Ensure cron daemon is enabled"
description: "Verify the cron daemon is enabled to execute scheduled batch jobs on the system"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - cron
cis_id: "5.1.1"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 5.1.1 Ensure cron daemon is enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `cron` daemon is used to execute batch jobs on the system.

## Rationale

While there may not be user jobs that need to be run on the system, the system does have maintenance jobs that may include security monitoring that have to run, and `cron` is used to execute them.

## Audit Procedure

Ensure proper start conditions listed for `cron`:

```bash
/sbin/initctl show-config cron
```

## Expected Result

```
cron
  start on runlevel [2345]
  stop on runlevel [!2345]
```

## Remediation

Edit start lines in `/etc/init/cron.conf` to match the following:

```bash
start on runlevel [2345]
```

## Default Value

Enabled by default on Ubuntu 14.04.

## References

- CIS Controls: 6 - Maintenance, Monitoring, and Analysis of Audit Logs

## Profile

- Level 1 - Server
- Level 1 - Workstation
