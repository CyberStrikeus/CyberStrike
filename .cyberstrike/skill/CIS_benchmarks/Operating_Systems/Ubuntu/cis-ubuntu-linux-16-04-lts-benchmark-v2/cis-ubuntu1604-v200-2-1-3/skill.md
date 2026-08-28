---
name: cis-ubuntu1604-v200-2-1-3
description: "Ensure Avahi Server is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.3 Ensure Avahi Server is not installed (Automated)

## Description

Avahi is a free zeroconf implementation, including a system for multicast DNS/DNS-SD service discovery. Avahi allows programs to publish and discover services and hosts running on a local network with no specific configuration. For example, a user can plug a computer into a network and Avahi automatically finds printers to print to, files to look at and people to talk to, as well as network services running on the machine.

## Rationale

Automatic discovery of network services is not normally required for system functionality. It is recommended to remove this package to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify avahi-daemon is not installed:

```bash
dpkg -s avahi-daemon | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'avahi-daemon' is not installed and no information is available
```

## Remediation

### Command Line

Run the following commands to remove avahi-daemon:

```bash
systemctl stop avahi-daaemon.service
systemctl stop avahi-daemon.socket
apt purge avahi-daemon
```

## Default Value

avahi-daemon is not installed on minimal server installations.

## References

1. CIS Controls v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile

- Level 1 - Server
- Level 1 - Workstation
