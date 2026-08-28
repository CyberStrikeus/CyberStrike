---
name: cis-ubuntu2004-v300-5-4-2-1
description: "Ensure root is the only UID 0 account"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, users, authentication]
cis_id: "5.4.2.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.2.1 Ensure root is the only UID 0 account (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Any account with UID 0 has superuser privileges on the system.

## Rationale

This access must be limited to only the default `root` account and only from the system console. Administrative access must be through an unprivileged account using an approved mechanism as noted in the Recommendation "Ensure access to the su command is restricted".

## Audit Procedure

### Command Line

Run the following command and verify that only "root" is returned:

```bash
# awk -F: '($3 == 0) { print $1 }' /etc/passwd
```

## Expected Result

```
root
```

## Remediation

### Command Line

Run the following command to change the `root` account UID to 0:

```bash
# usermod -u 0 root
```

Modify any users other than `root` with UID 0 and assign them a new UID.

## Default Value

None specified.

## References

1. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists: Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. (IG 1, IG 2, IG 3)

v7 - 14.6 Protect Information through Access Control Lists: Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. (IG 1, IG 2, IG 3)

MITRE ATT&CK Mappings: T1548, T1548.000 - Tactics: TA0001 - Mitigations: M1026
