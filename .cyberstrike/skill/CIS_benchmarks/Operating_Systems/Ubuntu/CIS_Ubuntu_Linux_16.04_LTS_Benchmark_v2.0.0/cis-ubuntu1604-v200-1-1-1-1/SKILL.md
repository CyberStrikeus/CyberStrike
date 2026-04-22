---
name: cis-ubuntu1604-v200-1-1-1-1
description: "Ensure mounting of cramfs filesystems is disabled"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, filesystem, cramfs, kernel-module]
cis_id: "1.1.1.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure mounting of cramfs filesystems is disabled

## Description

The cramfs filesystem type is a compressed read-only Linux filesystem embedded in small footprint systems. A cramfs image can be used without having to first decompress the image.

## Rationale

Removing support for unneeded filesystem types reduces the local attack surface of the server. If this filesystem type is not needed, disable it.

## Impact

None noted.

## Audit Procedure

### Command Line

```bash
# modprobe -n -v cramfs | grep -E '(cramfs|install)'
# lsmod | grep cramfs
```

## Expected Result

```
install /bin/true
```

The `lsmod` command should return no output.

## Remediation

### Command Line

```bash
# Edit or create a file in the /etc/modprobe.d/ directory ending in .conf
# Example: vim /etc/modprobe.d/cramfs.conf
# and add the following line:
install cramfs /bin/true

# Run the following command to unload the cramfs module:
rmmod cramfs
```

## Default Value

Not disabled by default.

## References

- CIS Controls Version 7 - 5.1 Establish Secure Configurations: Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile

Level 1 - Server / Level 1 - Workstation, Assessment: Automated
