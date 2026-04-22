---
name: cis-ubuntu2004-v300-1-1-2-6-1
description: "Ensure separate partition exists for /var/log"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, partition]
cis_id: "1.1.2.6.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure separate partition exists for /var/log

## Profile

Level 2 - Server, Level 2 - Workstation, Assessment: Automated

## Description

The `/var/log` directory is used by system services to store log data.

## Rationale

The default installation only creates a single `/` partition. Since the `/var/log` directory contains log files which can grow quite large, there is a risk of resource exhaustion. It will essentially have the whole disk available to fill up and impact the system as a whole.

Configuring `/var/log` as its own file system allows an administrator to set additional mount options such as `noexec/nosuid/nodev`. These options limit an attackers ability to create exploits on the system. Other options allow for specific behavior. See `man mount` for exact details regarding filesystem-independent and filesystem-specific options.

As `/var/log` contains log files, care should be taken to ensure the security and integrity of the data and mount point.

## Impact

Resizing filesystems is a common activity in cloud-hosted servers. Separate filesystem partitions may prevent successful resizing, or may require the installation of additional tools solely for the purpose of resizing operations. The use of these additional tools may introduce their own security considerations.

## Audit Procedure

### Command Line

Run the following command and verify output shows `/var/log` is mounted:

```bash
# findmnt -kn /var/log
```

Example output:

```
/var/log /dev/sdb ext4   rw,nosuid,nodev,noexec,relatime,seclabel
```

## Expected Result

`/var/log` should be mounted as a separate partition.

## Remediation

### Command Line

For new installations, during installation create a custom partition setup and specify a separate partition for `/var/log`.
For systems that were previously installed, create a new partition and configure `/etc/fstab` as appropriate.

## Default Value

Not configured by default.

## Additional Information

When modifying `/var/log` it is advisable to bring the system to emergency mode (so auditd is not running), rename the existing directory, mount the new file system, and migrate the data over before returning to multiuser mode.

## References

1. AJ Lewis, "LVM HOWTO", http://tldp.org/HOWTO/LVM-HOWTO/
2. NIST SP 800-53 Rev. 5:: CM-6 b CM-7
3. NIST SP 800-53A :: CM-6.1 (iv)
4. RHEL 8 STIG Vul ID: V-230293
5. RHEL 8 STIG Rule ID: SV-230293r902720

## CIS Controls

v8 - 8.3 Ensure Adequate Audit Log Storage (IG 1, IG 2, IG 3)
v7 - 6.4 Ensure adequate storage for logs (IG 2, IG 3)

MITRE ATT&CK Mappings: T1499, T1499.001 | TA0005 | M1022
