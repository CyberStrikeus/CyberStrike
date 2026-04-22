---
name: "CIS Ubuntu 14.04 LTS - 1.1.1.1 Ensure mounting of cramfs filesystems is disabled"
description: "Ensure the cramfs filesystem type is disabled to reduce attack surface"
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
cis_id: "1.1.1.1"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 1.1.1.1 Ensure mounting of cramfs filesystems is disabled (Scored)

## Profile Applicability
- Level 1 - Server
- Level 1 - Workstation

## Description
The cramfs filesystem type is a compressed read-only Linux filesystem embedded in small footprint systems. A cramfs image can be used without having to first decompress the image.

## Rationale
Removing support for unneeded filesystem types reduces the local attack surface of the server. If this filesystem type is not needed, disable it.

## Audit Procedure
```bash
modprobe -n -v cramfs
# Expected output: install /bin/true

lsmod | grep cramfs
# Expected output: <No output>
```

## Expected Result
`modprobe -n -v cramfs` should return `install /bin/true` and `lsmod | grep cramfs` should return no output.

## Remediation
```bash
# Edit or create the file /etc/modprobe.d/CIS.conf and add the following line:
echo "install cramfs /bin/true" >> /etc/modprobe.d/CIS.conf

# Unload the cramfs module:
rmmod cramfs
```

## Default Value
By default, cramfs filesystem mounting is allowed.

## References
- CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0
- CIS Controls: 13 Data Protection

## Profile
- Level 1
