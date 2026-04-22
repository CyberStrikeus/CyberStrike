---
name: cis-ubuntu2004-v300-2-1-13
description: "Ensure rsync services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.13"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.13 Ensure rsync services are not in use (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The rsync service can be used to synchronize files between systems over network links.

## Rationale

The rsync service presents a security risk as it uses unencrypted protocols for communication. Unless there is a need to run rsync as a daemon, it is recommended that the rsync service be disabled to reduce the remote attack surface.

## Audit Procedure

### Command Line

Run the following command to verify rsync is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' rsync
```

If installed, run:

```bash
# systemctl is-enabled rsync.service
# systemctl is-active rsync.service
```

Verify the service is not enabled and not active.

## Expected Result

rsync should not be installed as a service, or if installed, the service should be stopped and masked.

## Remediation

### Command Line

Run the following commands to stop, mask, and purge rsync:

```bash
# systemctl stop rsync.service
# systemctl mask rsync.service
# apt purge rsync
```

## Default Value

rsync may be installed but the daemon is not enabled by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |

MITRE ATT&CK Mappings: T1105, T1203, T1210, T1543, T1543.002, T1570 | TA0008 | M1042
