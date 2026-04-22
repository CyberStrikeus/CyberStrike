---
name: cis-ubuntu1604-v200-1-1-6
description: "Ensure /dev/shm is configured"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, filesystem, dev-shm, shared-memory, tmpfs]
cis_id: "1.1.6"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure /dev/shm is configured

## Description

/dev/shm is a traditional shared memory concept. One program will create a memory portion, which other processes (if permitted) can access. Mounting tmpfs at /dev/shm is handled automatically by systemd.

## Rationale

Any user can upload and execute files inside the /dev/shm similar to the /tmp partition. Configuring /dev/shm allows an administrator to set the noexec option on the mount, making /dev/shm useless for an attacker to install executable code. It would also prevent an attacker from establishing a hardlink to a system setuid program and wait for it to be updated. Once the program was updated, the hardlink would be broken and the attacker would have his own copy of the program. If the program happened to have a security vulnerability, the attacker could continue to exploit the known flaw.

## Impact

None noted.

## Audit Procedure

### Command Line

```bash
# Run the following command and verify output shows /dev/shm is mounted:
findmnt /dev/shm
```

## Expected Result

```
TARGET   SOURCE FSTYPE OPTIONS
/dev/shm tmpfs  tmpfs  rw,nosuid,nodev,noexec
```

## Remediation

### Command Line

```bash
# Edit /etc/fstab and add or edit the following line:
# tmpfs  /dev/shm  tmpfs  defaults,noexec,nodev,nosuid,seclabel  0 0

# Run the following command to remount /dev/shm:
mount -o remount,noexec,nodev,nosuid /dev/shm
```

## Default Value

By default /dev/shm is mounted automatically by systemd.

## References

- CIS Controls Version 7 - 5.1 Establish Secure Configurations: Maintain documented, standard security configuration standards for all authorized operating systems and software.
- CIS Controls Version 7 - 13 Data Protection.

## Profile

Level 1 - Server / Level 1 - Workstation, Assessment: Automated
