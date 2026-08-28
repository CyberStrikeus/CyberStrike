---
name: cis-ubuntu1804-v220-2-3-5
description: "Ensure LDAP client is not installed"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, ldap-client]
cis_id: "2.3.5"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.3.5 Ensure LDAP client is not installed (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The Lightweight Directory Access Protocol (LDAP) was introduced as a replacement for NIS/YP. It is a service that provides a method for looking up information from a central database.

## Rationale

If the system will not need to act as an LDAP client, it is recommended that the software be removed to reduce the potential attack surface.

## Impact

Removing the LDAP client will prevent or inhibit using LDAP for authentication in your environment.

## Audit Procedure

### Command Line

Verify that `ldap-utils` is not installed. Use the following command to provide the needed information:

```bash
# dpkg-query -s ldap-utils &>/dev/null && echo "ldap-utils is installed"
```

Nothing should be returned.

## Expected Result

No output (empty result).

## Remediation

### Command Line

Uninstall `ldap-utils`:

```bash
# apt purge ldap-utils
```

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

- v8: 4.8 - Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 9.2 - Ensure Only Approved Ports, Protocols and Services Are Running
