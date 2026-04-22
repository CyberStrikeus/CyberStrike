---
name: cis-ubuntu1204-v110-6-16
description: "Ensure rsync service is not enabled"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, rsync, rsyncd, file-transfer, attack-surface]
cis_id: "6.16"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.16 Ensure rsync service is not enabled (Not Scored)

## Profile Applicability
- Level 1

## Description
The `rsyncd` service can be used to synchronize files between systems over network links.

## Rationale
The `rsyncd` service presents a security risk as it uses unencrypted protocols for communication.

## Audit Procedure
### Using Command Line
Ensure that the `rsync` service is not enabled:
```bash
grep ^RSYNC_ENABLE /etc/default/rsync
```

## Expected Result
```
RSYNC_ENABLE=false
```

## Remediation
### Using Command Line
Set `RSYNC_ENABLE` to `false` in `/etc/default/rsync`:
```bash
sed -i 's/^RSYNC_ENABLE=.*/RSYNC_ENABLE=false/' /etc/default/rsync
```

## Default Value
rsync is disabled by default on Ubuntu 12.04 LTS Server (RSYNC_ENABLE=false).

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Not Scored
