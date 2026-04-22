---
name: cis-ubuntu1604-v200-4-2-1-4
description: "Ensure rsyslog default file permissions configured"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, logging, rsyslog]
cis_id: "4.2.1.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.2.1.4

## Profile
- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

rsyslog will create logfiles that do not already exist on the system. This setting controls what permissions will be applied to these newly created files.

## Rationale

It is important to ensure that log files have the correct permissions to ensure that sensitive data is archived and protected.

## Impact

None.

## Audit Procedure

Run the following command and verify that every instance of `$FileCreateMode` is `0640` or more restrictive:

### Command Line

```bash
grep ^\s*\$FileCreateMode /etc/rsyslog.conf /etc/rsyslog.d/*.conf
```

## Expected Result

If `$FileCreateMode` is not found, the default value 0644 is used and at least one `$FileCreateMode` has to be added.

## Remediation

Edit the `/etc/rsyslog.conf` and `/etc/rsyslog.d/*.conf` files and set every instance of `$FileCreateMode` to `0640` or more restrictive:

### Command Line

```bash
# Add or update the following line in /etc/rsyslog.conf or /etc/rsyslog.d/*.conf:
$FileCreateMode 0640
```

## Default Value

The default value for `$FileCreateMode` is 0644 if not explicitly set.

## References

1. See the rsyslog.conf(5) man page for more information.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v7 | 5.1 Establish Secure Configurations<br/>Maintain documented, standard security configuration standards for all authorized operating systems and software. | | | |
