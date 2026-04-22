---
name: cis-ubuntu1204-v110-1-1
description: "Install Updates, Patches and Additional Security Software"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, patching, updates, security-software]
cis_id: "1.1"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1 Install Updates, Patches and Additional Security Software (Not Scored)

## Profile Applicability
- Level 1

## Description
Periodically patches are released for included software either due to security flaws or to include additional functionality.

## Rationale
Newer patches may contain security enhancements that would not be available through the latest full update. As a result, it is recommended that the latest software patches be used to take advantage of the latest functionality. As with any software installation, organizations need to determine if a given update meets their requirements and verify the compatibility and supportability of any additional software against the update revision that is selected.

## Audit Procedure
### Using Command Line
```bash
apt-get update
apt-get --just-print upgrade
```

## Expected Result
If there are no packages to update, the system is up to date. If packages are listed, they should be reviewed and applied as appropriate.

## Remediation
### Using Command Line
```bash
apt-get upgrade
```

## Default Value
By default, Ubuntu does not automatically install updates.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Not Scored
