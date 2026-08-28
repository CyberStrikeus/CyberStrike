---
name: "CIS Ubuntu 14.04 LTS - 1.1.2 Ensure separate partition exists for /tmp"
description: "Ensure a separate partition exists for /tmp to prevent resource exhaustion"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-2
  - scored
  - filesystem
cis_id: "1.1.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 1.1.2 Ensure separate partition exists for /tmp (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

The /tmp directory is a world-writable directory used for temporary storage by all users and some applications.

## Rationale

Since the /tmp directory is intended to be world-writable, there is a risk of resource exhaustion if it is not bound to a separate partition. In addition, making /tmp its own file system allows an administrator to set the noexec option on the mount, making /tmp useless for an attacker to install executable code. It would also prevent an attacker from establishing a hardlink to a system setuid program and wait for it to be updated. Once the program was updated, the hardlink would be broken and the attacker would have his own copy of the program. If the program happened to have a security vulnerability, the attacker could continue to exploit the known flaw.

## Audit Procedure

```bash
mount | grep /tmp
# Expected output: tmpfs on /tmp type tmpfs (rw,nosuid,nodev,noexec,relatime)
```

## Expected Result

Verify output shows /tmp is mounted on a separate partition.

## Remediation

```bash
# For new installations, during installation create a custom partition setup
# and specify a separate partition for /tmp.
# For systems that were previously installed, create a new partition and
# configure /etc/fstab as appropriate.
```

## Default Value

By default, /tmp is not mounted on a separate partition.

## References

- CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0
- AJ Lewis, "LVM HOWTO", http://tldp.org/HOWTO/LVM-HOWTO/

## Notes

systemd includes the tmp.mount service which should be used instead of configuring /etc/fstab.

## Profile

- Level 2
