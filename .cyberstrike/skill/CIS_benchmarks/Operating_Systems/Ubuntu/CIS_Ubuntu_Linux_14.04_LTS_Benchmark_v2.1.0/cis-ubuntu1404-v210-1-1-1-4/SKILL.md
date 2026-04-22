---
name: "CIS Ubuntu 14.04 LTS - 1.1.1.4 Ensure mounting of hfs filesystems is disabled"
description: "Ensure the hfs filesystem type is disabled to reduce attack surface"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - filesystem
cis_id: "1.1.1.4"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 1.1.1.4 Ensure mounting of hfs filesystems is disabled (Scored)

## Profile Applicability
- Level 1 - Server
- Level 1 - Workstation

## Description
The hfs filesystem type is a hierarchical filesystem that allows you to mount Mac OS filesystems.

## Rationale
Removing support for unneeded filesystem types reduces the local attack surface of the system. If this filesystem type is not needed, disable it.

## Audit Procedure
```bash
modprobe -n -v hfs
# Expected output: install /bin/true

lsmod | grep hfs
# Expected output: <No output>
```

## Expected Result
`modprobe -n -v hfs` should return `install /bin/true` and `lsmod | grep hfs` should return no output.

## Remediation
```bash
# Edit or create the file /etc/modprobe.d/CIS.conf and add the following line:
echo "install hfs /bin/true" >> /etc/modprobe.d/CIS.conf

# Unload the hfs module:
rmmod hfs
```

## Default Value
By default, hfs filesystem mounting is allowed.

## References
- CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0
- CIS Controls: 13 Data Protection

## Profile
- Level 1
