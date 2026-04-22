---
name: cis-ubuntu2004-v300-2-2-5
description: "Ensure ldap client is not installed"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services, client, ldap]
cis_id: "2.2.5"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure ldap client is not installed

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The Lightweight Directory Access Protocol (LDAP) was introduced as a replacement for NIS/YP. It is a service that provides a method for looking up information from a central database.

## Rationale

If the system will not need to act as an LDAP client, it is recommended that the software be removed to reduce the potential attack surface.

## Impact

Removing the LDAP client will prevent or inhibit using LDAP for authentication in your environment.

## Audit

Verify that ldap-utils is not installed. Use the following command to provide the needed information:

### Command Line

```bash
# dpkg-query -s ldap-utils &>/dev/null && echo "ldap-utils is installed"
```

## Expected Result

Nothing should be returned.

## Remediation

Uninstall ldap-utils:

### Command Line

```bash
# apt purge ldap-utils
```

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software<br/>Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function. |      | ●    | ●    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running<br/>Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.                                       |      | ●    | ●    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques        | Tactics        | Mitigations  |
| ---------------------------------- | -------------- | ------------ |
| T1203, T1203.000, T1543, T1543.002 | TA0006, TA0008 | M1041, M1042 |
