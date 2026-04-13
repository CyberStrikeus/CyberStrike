---
name: cis-gcp-cos-4.2
description: "Ensure logrotate is configured"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, logging, logrotate, log-files]
cis_id: "4.2"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2 Ensure logrotate is configured (Manual)

## Description

The system includes the capability of rotating log files regularly to avoid filling up the system with logs or making the logs unmanageably large.

## Rationale

By keeping the log files smaller and more manageable, a system administrator can easily archive these files to another system and spend less time looking through inordinately large log files.

## Audit Procedure

Review `/etc/logrotate.conf` and `/etc/logrotate.d/*` and verify logs are rotated according to site policy.

```bash
# cat /etc/logrotate.conf
# ls /etc/logrotate.d/
```

## Expected Result

The output should show logrotate configuration files with appropriate rotation policies (e.g., daily, weekly, rotate count, compress settings) matching site policy.

## Remediation

Edit `/etc/logrotate.conf` and `/etc/logrotate.d/*` to ensure logs are rotated according to site policy.

`/etc` is stateless on Container-Optimized OS. Therefore, `/etc` cannot be used to make these changes persistent across reboots. The steps mentioned above needs to be performed after every boot.

## Default Value

If no `maxage` setting is set for logrotate a situation can occur where logrotate is interrupted and fails to delete rotated logfiles. It is recommended to set this to a value greater than the longest any log file should exist on your system to ensure that any such logfile is removed but standard rotation settings are not overridden.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | **8.3 Ensure Adequate Audit Log Storage** - Ensure that logging destinations maintain adequate storage to comply with the enterprise's audit log management process. | x | x | x |
| v7 | **6.4 Ensure adequate storage for logs** - Ensure that all systems that store logs have adequate storage space for the logs generated. | | x | x |

## Profile

- Level 2 - Server
