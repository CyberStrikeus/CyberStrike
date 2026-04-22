---
name: cis-ubuntu1604-v200-2-1-12
description: "Ensure Samba is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.12"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.12 Ensure Samba is not installed (Automated)

## Description

The Samba daemon allows system administrators to configure their Linux systems to share file systems and directories with Windows desktops. Samba will advertise the file systems and directories via the Server Message Block (SMB) protocol. Windows desktop users will be able to mount these directories and file systems as letter drives on their systems.

## Rationale

If there is no need to mount directories and file systems to Windows systems, then this service should be deleted to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify samba is not installed:

```bash
dpkg -s samba | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'samba' is not installed and no information is available
```

## Remediation

### Command Line

Run the following command to remove samba:

```bash
apt purge samba
```

## Default Value

samba is not installed on minimal server installations.

## References

1. CIS Controls v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile

- Level 1 - Server
- Level 1 - Workstation
