---
name: cis-ubuntu1604-v200-1-1-3
description: "Ensure nodev option set on /tmp partition"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, filesystem, tmp, nodev, mount-option]
cis_id: "1.1.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure nodev option set on /tmp partition

## Description

The nodev mount option specifies that the filesystem cannot contain special devices.

## Rationale

Since the /tmp filesystem is not intended to support devices, set this option to ensure that users cannot attempt to create block or character special devices in /tmp.

## Impact

None noted.

## Audit Procedure

### Command Line

```bash
# Verify that the nodev option is set if a /tmp partition exists
# Run the following command and verify that nothing is returned:
findmnt -n /tmp | grep -v nodev
```

## Expected Result

No output should be returned.

## Remediation

### Command Line

```bash
# Edit the /etc/fstab file OR the /etc/systemd/system/local-fs.target.wants/tmp.mount file:

# If /etc/fstab is used to mount /tmp:
# Edit the /etc/fstab file and add nodev to the fourth field (mounting options) for the /tmp partition.
# See the fstab(5) manual page for more information.
# Run the following command to remount /tmp:
mount -o remount,nodev /tmp

# OR If systemd is used to mount /tmp:
# Edit /etc/systemd/system/local-fs.target.wants/tmp.mount to add nodev to the /tmp mount options:
# [Mount]
# Options=mode=1777,strictatime,noexec,nodev,nosuid

# Run the following command to restart the systemd daemon:
systemctl daemon-reload

# Run the following command to restart tmp.mount
systemctl restart tmp.mount
```

## Default Value

Not set by default.

## References

- CIS Controls Version 7 - 5.1 Establish Secure Configurations: Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile

Level 1 - Server / Level 1 - Workstation, Assessment: Automated
