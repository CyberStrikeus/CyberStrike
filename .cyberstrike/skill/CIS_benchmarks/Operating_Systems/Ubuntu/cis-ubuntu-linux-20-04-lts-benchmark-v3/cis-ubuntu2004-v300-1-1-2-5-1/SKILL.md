---
name: cis-ubuntu2004-v300-1-1-2-5-1
description: "Ensure separate partition exists for /var/tmp"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, partition]
cis_id: "1.1.2.5.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure separate partition exists for /var/tmp

## Profile

Level 2 - Server, Level 2 - Workstation, Assessment: Automated

## Description

The `/var/tmp` directory is a world-writable directory used for temporary storage by all users and some applications. Temporary files residing in `/var/tmp` are to be preserved between reboots.

## Rationale

The default installation only creates a single `/` partition. Since the `/var/tmp` directory is world-writable, there is a risk of resource exhaustion. In addition, other operations on the system could fill up the disk unrelated to `/var/tmp` and cause potential disruption to daemons as the disk is full.

Configuring `/var/tmp` as its own file system allows an administrator to set additional mount options such as `noexec/nosuid/nodev`. These options limit an attacker's ability to create exploits on the system.

## Impact

Resizing filesystems is a common activity in cloud-hosted servers. Separate filesystem partitions may prevent successful resizing or may require the installation of additional tools solely for the purpose of resizing operations. The use of these additional tools may introduce their own security considerations.

## Audit Procedure

### Command Line

Run the following command and verify output shows `/var/tmp` is mounted.
Example:

```bash
# findmnt -kn /var/tmp
```

Example output:

```
/var/tmp   /dev/sdb ext4   rw,nosuid,nodev,noexec,relatime,seclabel
```

## Expected Result

`/var/tmp` should be mounted as a separate partition.

## Remediation

### Command Line

For new installations, during installation create a custom partition setup and specify a separate partition for `/var/tmp`.
For systems that were previously installed, create a new partition and configure `/etc/fstab` as appropriate.

## Default Value

Not configured by default.

## Additional Information

When modifying `/var/tmp` it is advisable to bring the system to emergency mode (so auditd is not running), rename the existing directory, mount the new file system, and migrate the data over before returning to multi-user mode.

## References

1. AJ Lewis, "LVM HOWTO", http://tldp.org/HOWTO/LVM-HOWTO/
2. NIST SP 800-53 Rev. 5: CM-7
3. NIST SP 800-53A :: CM-6.1 (iv)
4. RHEL 8 STIG Vul ID: V-244529
5. RHEL 8 STIG Rule ID: SV-244529r902737

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists (IG 1, IG 2, IG 3)
v7 - 14.6 Protect Information through Access Control Lists (IG 1, IG 2, IG 3)

MITRE ATT&CK Mappings: T1499, T1499.001 | TA0005 | M1022
