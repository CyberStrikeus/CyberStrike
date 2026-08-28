---
name: cis-ubuntu1604-v200-1-1-2
description: "Ensure /tmp is configured"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, filesystem, tmp, partition, tmpfs]
cis_id: "1.1.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure /tmp is configured

## Description

The /tmp directory is a world-writable directory used for temporary storage by all users and some applications.

## Rationale

Making /tmp its own file system allows an administrator to set the noexec option on the mount, making /tmp useless for an attacker to install executable code. It would also prevent an attacker from establishing a hardlink to a system setuid program and wait for it to be updated. Once the program was updated, the hardlink would be broken and the attacker would have his own copy of the program. If the program happened to have a security vulnerability, the attacker could continue to exploit the known flaw.

This can be accomplished by either mounting tmpfs to /tmp, or creating a separate partition for /tmp.

## Impact

Since the /tmp directory is intended to be world-writable, there is a risk of resource exhaustion if it is not bound to a separate partition.

Running out of /tmp space is a problem regardless of what kind of filesystem lies under it, but in a default installation a disk-based /tmp will essentially have the whole disk available, as it only creates a single / partition. On the other hand, a RAM-based /tmp as with tmpfs will almost certainly be much smaller, which can lead to applications filling up the filesystem much more easily.

/tmp utilizing tmpfs can be resized using the size={size} parameter on the Options line on the tmp.mount file.

## Audit Procedure

### Command Line

```bash
# findmnt /tmp
```

## Expected Result

```
TARGET SOURCE FSTYPE OPTIONS
/tmp   tmpfs  tmpfs  rw,nosuid,nodev,noexec
```

Verify output shows /tmp is mounted to tmpfs or a system partition.

## Remediation

### Command Line

```bash
# Configure /etc/fstab as appropriate.
# Example:
# tmpfs  /tmp  tmpfs  defaults,rw,nosuid,nodev,noexec,relatime  0 0

# OR Run the following commands to enable systemd /tmp mounting:
# Run the following command to create the tmp.mount file is the correct location:
cp -v /usr/share/systemd/tmp.mount /etc/systemd/system/

# Edit /etc/systemd/system/tmp.mount to configure the /tmp mount:
# [Mount]
# What=tmpfs
# Where=/tmp
# Type=tmpfs
# Options=mode=1777,strictatime,nosuid,nodev,noexec

# Run the following command to reload the systemd daemon with the updated tmp.mount unit file:
systemctl daemon-reload

# Run the following command to enable and start tmp.mount
systemctl --now enable tmp.mount
```

## Default Value

By default /tmp is not configured as a separate partition or tmpfs mount.

## References

- AJ Lewis, "LVM HOWTO", http://tldp.org/HOWTO/LVM-HOWTO/
- https://www.freedesktop.org/wiki/Software/systemd/APIFileSystems/
- CIS Controls Version 7 - 5.1 Establish Secure Configurations: Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile

Level 1 - Server / Level 1 - Workstation, Assessment: Automated
