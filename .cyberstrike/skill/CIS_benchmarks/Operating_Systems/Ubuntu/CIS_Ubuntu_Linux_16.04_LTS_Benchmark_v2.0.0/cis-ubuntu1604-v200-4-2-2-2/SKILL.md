---
name: cis-ubuntu1604-v200-4-2-2-2
description: "Ensure journald is configured to compress large log files"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, logging, rsyslog]
cis_id: "4.2.2.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.2.2.2

## Profile
- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

The journald system includes the capability of compressing overly large files to avoid filling up the system with logs or making the logs unmanageably large.

**Note:** The main configuration file `/etc/systemd/journald.conf` is read before any of the custom *.conf files. If there are custom configs present, they override the main configuration parameters.

## Rationale

Uncompressed large files may unexpectedly fill a filesystem leading to resource unavailability. Compressing logs prior to write can prevent sudden, unexpected filesystem impacts.

## Impact

None.

## Audit Procedure

Review `/etc/systemd/journald.conf` and verify that large files will be compressed:

### Command Line

```bash
grep -e Compress /etc/systemd/journald.conf
```

## Expected Result

```
Compress=yes
```

## Remediation

Edit the `/etc/systemd/journald.conf` file and add the following line:

### Command Line

```bash
# Add or update the following in /etc/systemd/journald.conf:
Compress=yes
```

## Default Value

Compress is not explicitly set by default but journald defaults to compressing logs.

## References

1. https://github.com/konstruktoid/hardening/blob/master/systemd.adoc#etcsystemdjournaldconf

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v7 | 6.4 Ensure adequate storage for logs<br/>Ensure that all systems that store logs have adequate storage space for the logs generated. | | | |
