---
name: cis-ubuntu1604-v200-1-1-5
description: "Ensure noexec option set on /tmp partition"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, filesystem, tmp, noexec, mount-option]
cis_id: "1.1.5"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure noexec option set on /tmp partition

## Description

The noexec mount option specifies that the filesystem cannot contain executable binaries.

## Rationale

Since the /tmp filesystem is only intended for temporary file storage, set this option to ensure that users cannot run executable binaries from /tmp.

## Impact

None noted.

## Audit Procedure

### Command Line

```bash
# If a /tmp partition exists, verify that the noexec option is set.
# Run the following command and verify that nothing is returned:
findmnt -n /tmp | grep -v noexec
```

## Expected Result

No output should be returned.

## Remediation

### Command Line

```bash
# Edit the /etc/fstab file and add noexec to the fourth field (mounting options) for the /tmp partition.
# See the fstab(5) manual page for more information.
# Run the following command to remount /tmp:
mount -o remount,noexec /tmp

# OR Edit /etc/systemd/system/local-fs.target.wants/tmp.mount to add noexec to the /tmp mount options:
# [Mount]
# Options=mode=1777,strictatime,noexec,nodev,nosuid

# Run the following command to remount /tmp:
mount -o remount,noexec /tmp
```

## Default Value

Not set by default.

## References

- CIS Controls Version 7 - 2.6 Address unapproved software: Ensure that unauthorized software is either removed or the inventory is updated in a timely manner.

## Profile

Level 1 - Server / Level 1 - Workstation, Assessment: Automated
