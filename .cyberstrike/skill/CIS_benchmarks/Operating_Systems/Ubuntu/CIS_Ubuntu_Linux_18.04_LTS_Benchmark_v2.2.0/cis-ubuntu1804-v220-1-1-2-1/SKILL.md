---
name: cis-ubuntu1804-v220-1-1-2-1
description: "Ensure /tmp is a separate partition"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, partition, tmp, mount]
cis_id: "1.1.2.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure /tmp is a separate partition

## Profile

Level 1 - Server / Level 1 - Workstation, Assessment: Automated

## Description

The /tmp directory is a world-writable directory used for temporary storage by all users and some applications.

## Rationale

Making /tmp its own file system allows an administrator to set additional mount options such as the noexec option on the mount, making /tmp useless for an attacker to install executable code. It would also prevent an attacker from establishing a hard link to a system setuid program and wait for it to be updated. Once the program was updated, the hard link would be broken and the attacker would have his own copy of the program. If the program happened to have a security vulnerability, the attacker could continue to exploit the known flaw.

This can be accomplished by either mounting tmpfs to /tmp, or creating a separate partition for /tmp.

## Impact

Since the /tmp directory is intended to be world-writable, there is a risk of resource exhaustion if it is not bound to a separate partition.

Running out of /tmp space is a problem regardless of what kind of filesystem lies under it, but in a configuration where /tmp is not a separate file system it will essentially have the whole disk available, as the default installation only creates a single / partition. On the other hand, a RAM-based /tmp (as with tmpfs) will almost certainly be much smaller, which can lead to applications filling up the filesystem much more easily. Another alternative is to create a dedicated partition for /tmp from a separate volume or disk. One of the downsides of a disk-based dedicated partition is that it will be slower than tmpfs which is RAM-based.

/tmp utilizing tmpfs can be resized using the size={size} parameter in the relevant entry in /etc/fstab.

## Audit Procedure

### Command Line

Run the following command and verify the output shows that /tmp is mounted. Particular requirements pertaining to mount options are covered in ensuing sections.

```bash
# findmnt -nk /tmp
```

## Expected Result

```
/tmp     tmpfs  tmpfs   rw,nosuid,nodev,noexec
```

## Remediation

### Command Line

For specific configuration requirements of the /tmp mount for your environment, modify /etc/fstab or tmp.mount unit file:

Using /etc/fstab:

```bash
# Configure /etc/fstab as appropriate:
# Example:
tmpfs   /tmp   tmpfs   defaults,rw,nosuid,nodev,noexec,relatime   0 0
```

-OR-

Using a tmp.mount unit file:

```bash
# cp -v /usr/share/systemd/tmp.mount /etc/systemd/system/

# Edit /etc/systemd/system/tmp.mount to configure the /tmp mount:
# [Mount]
# What=tmpfs
# Where=/tmp
# Type=tmpfs
# Options=mode=1777,strictatime,nosuid,nodev,noexec

# Reload the systemd daemon:
systemctl daemon-reload

# Enable and start tmp.mount:
systemctl --now enable tmp.mount
```

Note: A reboot may be required to transition to /tmp mounted to tmpfs.

## Default Value

By default /tmp is not a separate partition.

## References

1. https://www.freedesktop.org/wiki/Software/systemd/APIFileSystems/
2. https://www.freedesktop.org/software/systemd/man/systemd-fstab-generator.html
3. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists (IG 1, IG 2, IG 3)
v7 - 14.6 Protect Information through Access Control Lists (IG 1, IG 2, IG 3)

MITRE ATT&CK Mappings: T1499, T1499.001 (TA0005) - M1022
