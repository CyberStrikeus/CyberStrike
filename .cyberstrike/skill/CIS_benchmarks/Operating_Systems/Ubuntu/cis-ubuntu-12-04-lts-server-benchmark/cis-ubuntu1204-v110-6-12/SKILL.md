---
name: cis-ubuntu1204-v110-6-12
description: "Ensure Samba is not enabled"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, samba, smb, file-sharing, attack-surface]
cis_id: "6.12"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.12 Ensure Samba is not enabled (Not Scored)

## Profile Applicability

- Level 1

## Description

The Samba daemon allows system administrators to configure their Linux systems to share file systems and directories with Windows desktops. Samba will advertise the file systems and directories via the Small Message Block (SMB) protocol. Windows desktop users will be able to mount these directories and file systems as letter drives on their systems.

## Rationale

If there is no need to mount directories and file systems to Windows systems, then this service can be deleted to reduce the potential attack surface.

## Audit Procedure

### Using Command Line

Ensure no start conditions listed for `smbd`:

```bash
initctl show-config smbd smbd
```

## Expected Result

No start conditions should be listed for smbd.

## Remediation

### Using Command Line

Remove or comment out start lines in `/etc/init/smbd.conf`:

```bash
sed -i 's/^start/#start/' /etc/init/smbd.conf
```

## Default Value

Not installed by default on Ubuntu 12.04 LTS Server.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Not Scored
