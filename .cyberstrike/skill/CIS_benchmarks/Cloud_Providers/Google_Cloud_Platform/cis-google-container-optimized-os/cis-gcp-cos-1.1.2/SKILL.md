---
name: cis-gcp-cos-1.1.2
description: "Ensure /tmp is configured"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, filesystem, partitions, mount-options, tmp]
cis_id: "1.1.2"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1.2 Ensure /tmp is configured (Automated)

## Description

The `/tmp` directory is a world-writable directory used for temporary storage by all users and some applications.

## Rationale

Making /tmp its own file system allows an administrator to set the noexec option on the mount, making /tmp useless for an attacker to install executable code. It would also prevent an attacker from establishing a hardlink to a system setuid program and wait for it to be updated. Once the program was updated, the hardlink would be broken and the attacker would have his own copy of the program. If the program happened to have a security vulnerability, the attacker could continue to exploit the known flaw.

This can be accomplished by either mounting tmpfs to /tmp, or creating a separate partition for /tmp.

## Impact

Since the `/tmp` directory is intended to be world-writable, there is a risk of resource exhaustion if it is not bound to a separate partition.

Running out of /tmp space is a problem regardless of what kind of filesystem lies under it, but in a default installation a disk-based /tmp will essentially have the whole disk available, as it only creates a single / partition. On the other hand, a RAM-based /tmp as with tmpfs will almost certainly be much smaller, which can lead to applications filling up the filesystem much more easily.

/tmp utilizing tmpfs can be resized using the size={size} parameter on the Options line on the tmp.mount file.

## Audit Procedure

Run the following command and verify output shows `/tmp` is mounted:

```bash
# mount | grep -E '\s/tmp\s'
tmpfs on /tmp type tmpfs (rw,nosuid,nodev,noexec,relatime)
```

Run the following command and verify that output shows `static`:

```bash
# systemctl is-enabled tmp.mount
static
```

## Expected Result

- `mount | grep -E '\s/tmp\s'` should show tmpfs mounted on /tmp with appropriate options (rw,nosuid,nodev,noexec,relatime)
- `systemctl is-enabled tmp.mount` should return `static`

## Remediation

Run the following commands to configure mount options:

```bash
systemctl edit tmp.mount
```

Edit the file to define the options that needs to be set. For example:

```
[Mount]
Options=
Options=mode=1777,strictatime,noexec,nodev,nosuid
```

Restart the tmp.mount:

```bash
systemctl daemon-reload # might be optional
systemctl restart tmp.mount
```

**Note:** `/etc` is stateless on Container-Optimized OS. Therefore, `/etc` cannot be used to make these changes persistent across reboots. The steps mentioned above needs to be performed after every boot.

## References

1. AJ Lewis, "LVM HOWTO", http://tldp.org/HOWTO/LVM-HOWTO/
2. https://www.freedesktop.org/wiki/Software/systemd/APIFileSystems/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | x    | x    | x    |
| v7               | 5.1 Establish Secure Configurations - Maintain documented, standard security configuration standards for all authorized operating systems and software.                                                                                         | x    | x    | x    |

## Profile

Level 1 - Server | Automated
