---
name: "CIS Ubuntu 14.04 LTS - 4.2.1.3 Ensure rsyslog default file permissions configured"
description: "Configure rsyslog to create log files with restrictive permissions (0640)"
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
  - permissions
  - logging
cis_id: "4.2.1.3"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 4.2.1.3 Ensure rsyslog default file permissions configured (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

rsyslog will create logfiles that do not already exist on the system. This setting controls what permissions will be applied to these newly created files.

## Rationale

It is important to ensure that log files have the correct permissions to ensure that sensitive data is archived and protected.

## Audit Procedure

Run the following command and verify that `$FileCreateMode` is `0640` or more restrictive:

```bash
grep ^\$FileCreateMode /etc/rsyslog.conf /etc/rsyslog.d/*.conf
```

## Expected Result

```
$FileCreateMode 0640
```

## Remediation

Edit the `/etc/rsyslog.conf` and `/etc/rsyslog.d/*.conf` files and set `$FileCreateMode` to `0640` or more restrictive:

```bash
$FileCreateMode 0640
```

**Notes:** You should also ensure this is not overridden with less restrictive settings in any `/etc/rsyslog.d/*` conf file.

## Default Value

Not explicitly set by default.

## References

1. See the rsyslog.conf(5) man page for more information.

## Profile

- Level 1 - Server
- Level 1 - Workstation
