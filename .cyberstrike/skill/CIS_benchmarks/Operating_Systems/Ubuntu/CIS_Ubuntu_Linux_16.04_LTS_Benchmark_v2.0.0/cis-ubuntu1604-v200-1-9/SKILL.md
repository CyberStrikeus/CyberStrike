---
name: cis-ubuntu1604-v200-1-9
description: "Ensure updates, patches, and additional security software are installed"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, updates, patches, security-software, patch-management]
cis_id: "1.9"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.9

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Periodically patches are released for included software either due to security flaws or to include additional functionality.

## Rationale

Newer patches may contain security enhancements that would not be available through the latest full update. As a result, it is recommended that the latest software patches be used to take advantage of the latest functionality. As with any software installation, organizations need to determine if a given update meets their requirements and verify the compatibility and supportability of any additional software against the update revision that is selected.

## Audit Procedure

### Command Line

Run the following command and verify there are no updates or patches to install:

```bash
apt -s upgrade
```

## Expected Result

No packages should be listed as available for upgrade.

## Remediation

### Command Line

Run the following command to install available updates:

```bash
apt upgrade
```

OR

```bash
apt dist-upgrade
```

## Default Value

Not applicable.

## References

None.

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 3.4 Deploy Automated Operating System Patch Management Tools |
| v7 | 3.5 Deploy Automated Software Patch Management Tools |

## Assessment Status

Manual
