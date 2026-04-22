---
name: cis-ubuntu1804-v220-1-1-8-2
description: "Ensure noexec option set on /dev/shm partition"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, partition, dev-shm, mount-option, noexec, shared-memory]
cis_id: "1.1.8.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure noexec option set on /dev/shm partition

## Profile

Level 1 - Server / Level 1 - Workstation, Assessment: Automated

## Description

The noexec mount option specifies that the filesystem cannot contain executable binaries.

## Rationale

Setting this option on a world-writable directory, to prevent users from running executable binaries from shared memory, prevents certain types of attacks including arbitrary binary execution and malicious shared library injection.

## Impact

None noted.

## Audit Procedure

### Command Line

Verify that the noexec option is set for the /dev/shm mount.

```bash
# findmnt -kn /dev/shm | grep noexec
```

## Expected Result

```
/dev/shm     tmpfs  tmpfs   rw,nosuid,nodev,noexec,relatime,seclabel
```

## Remediation

### Command Line

Edit the /etc/fstab file and add noexec to the fourth field (mounting options) for the /dev/shm partition. It is recommended that /dev/shm is mounted as tmpfs.

```bash
# Example:
tmpfs   /dev/shm   tmpfs   defaults,rw,nosuid,nodev,noexec,relatime   0 0

# Run the following command to remount /dev/shm with the configured options:
mount -o remount /dev/shm
```

Note: Some distributions may mount /dev/shm through other means (e.g. systemd). If this is the case, verify that the mount options are configured correctly in the relevant configuration file.

## Default Value

Not set by default on all distributions.

## References

1. See the fstab(5) manual page for more information.
2. NIST SP 800-53 Rev. 5: AC-3, MP-2

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists (IG 1, IG 2, IG 3)
v7 - 14.6 Protect Information through Access Control Lists (IG 1, IG 2, IG 3)

MITRE ATT&CK Mappings: T1204, T1204.002 (TA0005) - M1022
