---
name: cis-ubuntu2004-v300-2-1-22
description: "Ensure only approved services are listening on a network interface"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.22"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.22 Ensure only approved services are listening on a network interface (Manual)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Services listening on any network interface provide an attack surface for exploitation. Reviewing all services listening on the network is important to identify those that may not be necessary and could potentially be disabled.

## Rationale

Services listening on the system pose a potential risk as an attack vector. These services should be reviewed, and if not required, the service should be stopped and disabled, or the software should be removed.

## Audit Procedure

### Command Line

Run the following command to review all services listening on the system:

```bash
# ss -plntu
```

Review the output to verify all services listening on the system are approved by site policy.

## Expected Result

Only approved services should be listening on network interfaces.

## Remediation

### Command Line

For each unauthorized service:

1. Stop and mask the service:

```bash
# systemctl stop <service_name>
# systemctl mask <service_name>
```

2. If the package is not required, remove it:

```bash
# apt purge <package_name>
```

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |

MITRE ATT&CK Mappings: T1203, T1210, T1543, T1543.002 | TA0008 | M1042
