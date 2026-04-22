---
name: "CIS Ubuntu 14.04 LTS - 4.2.2.3 Ensure syslog-ng default file permissions configured"
description: "Configure syslog-ng to create log files with restrictive permissions (0640)"
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
  - permissions
  - logging
cis_id: "4.2.2.3"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 4.2.2.3 Ensure syslog-ng default file permissions configured (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

syslog-ng will create logfiles that do not already exist on the system. This setting controls what permissions will be applied to these newly created files.

## Rationale

It is important to ensure that log files exist and have the correct permissions to ensure that sensitive `syslog-ng` data is archived and protected.

## Audit Procedure

Run the following command and verify the `perm` option is `0640` or more restrictive:

```bash
grep ^options /etc/syslog-ng/syslog-ng.conf
```

## Expected Result

```
options { chain_hostnames(off); flush_lines(0); perm(0640); stats_freq(3600); threaded(yes); };
```

## Remediation

Edit the `/etc/syslog-ng/syslog-ng.conf` and set `perm` option to `0640` or more restrictive:

```bash
options { chain_hostnames(off); flush_lines(0); perm(0640); stats_freq(3600); threaded(yes); };
```

## Default Value

Not explicitly configured by default.

## References

1. See the syslog-ng man pages for more information.

## Profile

- Level 1 - Server
- Level 1 - Workstation
