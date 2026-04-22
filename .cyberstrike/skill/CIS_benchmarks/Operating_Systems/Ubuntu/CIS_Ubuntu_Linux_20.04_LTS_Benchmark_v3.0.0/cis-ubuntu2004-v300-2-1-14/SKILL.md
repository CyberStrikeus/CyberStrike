---
name: cis-ubuntu2004-v300-2-1-14
description: "Ensure samba file server services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.14"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.14 Ensure samba file server services are not in use (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The Samba daemon allows system administrators to configure their Linux systems to share file systems and directories with Windows desktops. Samba will advertise the file systems and directories via the Server Message Block (SMB) protocol.

## Rationale

If there is no need to share file systems and directories with Windows systems, then Samba should be disabled to reduce the remote attack surface.

## Audit Procedure

### Command Line

Run the following command to verify samba is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' samba
```

If installed, run:

```bash
# systemctl is-enabled smbd.service
# systemctl is-active smbd.service
```

Verify the service is not enabled and not active.

## Expected Result

samba should not be installed, or if installed, the service should be stopped and masked.

## Remediation

### Command Line

Run the following commands to stop, mask, and purge samba:

```bash
# systemctl stop smbd.service
# systemctl mask smbd.service
# apt purge samba
```

## Default Value

samba is not installed by default.

## References

1. NIST SP 800-53 Rev. 5: CM-6, CM-7

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |

MITRE ATT&CK Mappings: T1005, T1039, T1083, T1135, T1203, T1210, T1543, T1543.002 | TA0008
