---
name: cis-ubuntu2004-v300-1-1-2-2-1
description: "Ensure /dev/shm is a separate partition"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, partition]
cis_id: "1.1.2.2.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure /dev/shm is a separate partition

## Profile

Level 1 - Server, Level 1 - Workstation, Assessment: Automated

## Description

The `/dev/shm` directory is a world-writable directory that can function as shared memory that facilitates inter process communication (IPC).

## Rationale

Making `/dev/shm` its own file system allows an administrator to set additional mount options such as the `noexec` option on the mount, making `/dev/shm` useless for an attacker to install executable code. It would also prevent an attacker from establishing a hard link to a system `setuid` program and wait for it to be updated. Once the program was updated, the hard link would be broken and the attacker would have his own copy of the program. If the program happened to have a security vulnerability, the attacker could continue to exploit the known flaw.

This can be accomplished by mounting `tmpfs` to `/dev/shm`.

## Impact

Since the `/dev/shm` directory is intended to be world-writable, there is a risk of resource exhaustion if it is not bound to a separate partition.

`/dev/shm` utilizing `tmpfs` can be resized using the `size={size}` parameter in the relevant entry in `/etc/fstab`.

## Audit Procedure

### Command Line

- IF - `/dev/shm` is to be used on the system, run the following command and verify the output shows that `/dev/shm` is mounted. Particular requirements pertaining to mount options are covered in ensuing sections.

```bash
# findmnt -kn /dev/shm
```

Example output:

```
/dev/shm   tmpfs  tmpfs  rw,nosuid,nodev,noexec,relatime,seclabel
```

## Expected Result

`/dev/shm` should be mounted as a separate partition with appropriate mount options.

## Remediation

### Command Line

For specific configuration requirements of the `/dev/shm` mount for your environment, modify `/etc/fstab`.
Example:

```
tmpfs   /dev/shm tmpfs   defaults,rw,nosuid,nodev,noexec,relatime,size=2G   0 0
```

## Default Value

Not configured by default.

## References

1. https://www.freedesktop.org/wiki/Software/systemd/APIFileSystems/
2. https://www.freedesktop.org/software/systemd/man/systemd-fstab-generator.html
3. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists (IG 1, IG 2, IG 3)
v7 - 14.6 Protect Information through Access Control Lists (IG 1, IG 2, IG 3)

MITRE ATT&CK Mappings: T1499, T1499.001 | TA0005 | M1022
