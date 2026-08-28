---
name: cis-ubuntu1204-v110-7-2-4
description: "Log Suspicious Packets"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, logging, martians, sysctl, host-router]
cis_id: "7.2.4"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.2.4 Log Suspicious Packets (Scored)

## Profile Applicability

- Level 1

## Description

When enabled, this feature logs packets with un-routable source addresses to the kernel log.

## Rationale

Enabling this feature and logging these packets allows an administrator to investigate the possibility that an attacker is sending spoofed packets to their server.

## Audit Procedure

### Using Command Line

Perform the following to determine if suspicious packets are logged.

```bash
/sbin/sysctl net.ipv4.conf.all.log_martians
/sbin/sysctl net.ipv4.conf.default.log_martians
```

## Expected Result

```
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1
```

## Remediation

### Using Command Line

Set the `net.ipv4.conf.all.log_martians` and `net.ipv4.conf.default.log_martians` parameters to 1 in `/etc/sysctl.conf`:

```bash
net.ipv4.conf.all.log_martians=1
net.ipv4.conf.default.log_martians=1
```

Modify active kernel parameters to match:

```bash
/sbin/sysctl -w net.ipv4.conf.all.log_martians=1
/sbin/sysctl -w net.ipv4.conf.default.log_martians=1
/sbin/sysctl -w net.ipv4.route.flush=1
```

## Default Value

Logging of suspicious packets is disabled by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
