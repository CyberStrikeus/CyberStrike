---
name: cis-ubuntu2004-v300-2-1-10
description: "Ensure nis server services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.10"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.10 Ensure nis server services are not in use (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The Network Information Service (NIS) (formally known as Yellow Pages) is a client-server directory service protocol for distributing system configuration files. The NIS server software is the ypserv package.

## Rationale

The NIS service is inherently an insecure system that has been vulnerable to DOS attacks, buffer overflows and has poor authentication for querying NIS maps. NIS generally has been replaced by LDAP based authentication. It is recommended that the service be disabled and more secure services be used.

## Audit Procedure

### Command Line

Run the following command to verify ypserv is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' ypserv
```

If installed, run:

```bash
# systemctl is-enabled ypserv.service
# systemctl is-active ypserv.service
```

Verify the service is not enabled and not active.

## Expected Result

ypserv should not be installed, or if installed, the service should be stopped and masked.

## Remediation

### Command Line

Run the following commands to stop, mask, and purge ypserv:

```bash
# systemctl stop ypserv.service
# systemctl mask ypserv.service
# apt purge ypserv
```

## Default Value

ypserv is not installed by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |

MITRE ATT&CK Mappings: T1203, T1210, T1543, T1543.002 | TA0008 | M1042
