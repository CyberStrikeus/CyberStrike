---
name: cis-ubuntu2004-v300-2-1-4
description: "Ensure dns server services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.4 Ensure dns server services are not in use (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The Domain Name System (DNS) is a hierarchical naming system that maps names to IP addresses for computers, services and other resources connected to a network.

## Rationale

Unless a system is specifically designated to act as a DNS server, it is recommended that the service be disabled to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify bind9 is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' bind9
```

If installed, run:

```bash
# systemctl is-enabled named.service
# systemctl is-active named.service
```

Verify the service is not enabled and not active.

## Expected Result

bind9 should not be installed, or if installed, the service should be stopped and masked.

## Remediation

### Command Line

Run the following commands to stop, mask, and purge bind9:

```bash
# systemctl stop named.service
# systemctl mask named.service
# apt purge bind9
```

## Default Value

bind9 is not installed by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | x    | x    |

MITRE ATT&CK Mappings: T1203, T1210, T1543, T1543.002 | TA0008 | M1042
