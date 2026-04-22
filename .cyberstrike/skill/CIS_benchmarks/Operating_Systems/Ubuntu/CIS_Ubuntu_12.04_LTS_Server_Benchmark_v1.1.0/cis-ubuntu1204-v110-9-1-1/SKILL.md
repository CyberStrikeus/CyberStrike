---
name: cis-ubuntu1204-v110-9-1-1
description: "Enable cron Daemon"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, authentication, cron, scheduling]
cis_id: "9.1.1"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.1.1 Enable cron Daemon (Scored)

## Profile Applicability

- Level 1

## Description

The `cron` daemon is used to execute batch jobs on the system.

## Rationale

While there may not be user jobs that need to be run on the system, the system does have maintenance jobs that may include security monitoring that have to run and `cron` is used to execute them.

## Audit Procedure

### Using Command Line

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

### Using Command Line

Edit start lines in `/etc/init/cron.conf` to match the following:

```bash
start on runlevel [2345]
```

## Default Value

cron is enabled by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
