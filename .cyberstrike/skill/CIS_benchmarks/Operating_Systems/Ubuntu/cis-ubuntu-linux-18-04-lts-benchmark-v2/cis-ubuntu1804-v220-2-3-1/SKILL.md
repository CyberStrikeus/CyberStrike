---
name: cis-ubuntu1804-v220-2-3-1
description: "Ensure NIS Client is not installed"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, nis-client]
cis_id: "2.3.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.3.1 Ensure NIS Client is not installed (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The Network Information Service (NIS), formerly known as Yellow Pages, is a client-server directory service protocol used to distribute system configuration files. The NIS client was used to bind a machine to an NIS server and receive the distributed configuration files.

## Rationale

The NIS service is inherently an insecure system that has been vulnerable to DOS attacks, buffer overflows and has poor authentication for querying NIS maps. NIS generally has been replaced by such protocols as Lightweight Directory Access Protocol (LDAP). It is recommended that the service be removed.

## Impact

Many insecure service clients are used as troubleshooting tools and in testing environments. Uninstalling them can inhibit capability to test and troubleshoot. If they are required it is advisable to remove the clients after use to prevent accidental or intentional misuse.

## Audit Procedure

### Command Line

Verify `nis` is not installed. Use the following command to provide the needed information:

```bash
# dpkg-query -s nis &>/dev/null && echo "nis is installed"
```

Nothing should be returned.

## Expected Result

No output (empty result).

## Remediation

### Command Line

Uninstall `nis`:

```bash
# apt purge nis
```

## References

1. NIST SP 800-53 Rev. 5: CM-7, CM-11

## CIS Controls

- v8: 4.8 - Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 2.6 - Address unapproved software
