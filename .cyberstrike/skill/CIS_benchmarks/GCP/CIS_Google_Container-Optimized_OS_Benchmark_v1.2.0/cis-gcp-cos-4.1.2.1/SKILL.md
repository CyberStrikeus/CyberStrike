---
name: cis-gcp-cos-4.1.2.1
description: "Ensure journald is configured to compress large log files"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, logging, journald, log-files]
cis_id: "4.1.2.1"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.2.1 Ensure journald is configured to compress large log files (Automated)

## Description

The journald system includes the capability of compressing overly large files to avoid filling up the system with logs or making the logs unmanageably large.

## Rationale

Uncompressed large files may unexpectedly fill a filesystem leading to resource unavailability. Compressing logs prior to write can prevent sudden, unexpected filesystem impacts.

## Audit Procedure

Review `/etc/systemd/journald.conf` and verify that large files will be compressed:

```bash
# grep -e Compress /etc/systemd/journald.conf
# Compress=yes
```

## Expected Result

The output should show `Compress=yes`.

## Remediation

Edit the `/etc/systemd/journald.conf` file and add the following line:

```
Compress=yes
```

Reload the configuration to be effective.

```bash
# systemctl force-reload systemd-journald
```

`/etc` is stateless on Container-Optimized OS. Therefore, `/etc` cannot be used to make these changes persistent across reboots. The steps mentioned above needs to be performed after every boot.

## Default Value

The main configuration file `/etc/systemd/journald.conf` is read before any of the custom \*.conf files. If there are custom configs present, they override the main configuration parameters.

## References

1. https://github.com/konstruktoid/hardening/blob/master/systemd.adoc#etcsystemdjournaldconf

## CIS Controls

| Controls Version | Control                                                                                                                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | **8.3 Ensure Adequate Audit Log Storage** - Ensure that logging destinations maintain adequate storage to comply with the enterprise's audit log management process. | x    | x    | x    |
| v7               | **6.4 Ensure adequate storage for logs** - Ensure that all systems that store logs have adequate storage space for the logs generated.                               |      | x    | x    |

## Profile

- Level 2 - Server
