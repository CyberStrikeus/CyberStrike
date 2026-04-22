---
name: cis-ubuntu1804-v220-2-2-11
description: "Ensure Samba is not installed"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, samba]
cis_id: "2.2.11"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.11 Ensure Samba is not installed (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The Samba daemon allows system administrators to configure their Linux systems to share file systems and directories with Windows desktops. Samba will advertise the file systems and directories via the Server Message Block (SMB) protocol. Windows desktop users will be able to mount these directories and file systems as letter drives on their systems.

## Rationale

If there is no need to mount directories and file systems to Windows systems, then this service should be deleted to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify `samba` is not installed:

```bash
# dpkg-query -s samba &>/dev/null && echo "samba is installed"
```

Nothing should be returned.

## Expected Result

No output (empty result).

## Remediation

### Command Line

Run the following command to remove `samba`:

```bash
# apt purge samba
```

## References

1. NIST SP 800-53 Rev. 5: CM-6, CM-7

## CIS Controls

- v8: 4.8 - Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 9.2 - Ensure Only Approved Ports, Protocols and Services Are Running
