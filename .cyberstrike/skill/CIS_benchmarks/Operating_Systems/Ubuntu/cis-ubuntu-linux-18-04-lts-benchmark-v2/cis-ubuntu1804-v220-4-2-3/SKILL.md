---
name: cis-ubuntu1804-v220-4-2-3
description: "Ensure sshd access is configured"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, ssh, remote-access]
cis_id: "4.2.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.2.3

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

There are several options available to limit which users and groups can access the system via SSH. It is recommended that at least one of the following options be leveraged: `AllowUsers`, `AllowGroups`, `DenyUsers`, `DenyGroups`.

## Rationale

Restricting which users can remotely access the system via SSH will help ensure that only authorized users access the system.

## Audit Procedure

### Command Line

Run the following commands and verify that the output matches for at least one:

```bash
sshd -T | grep -Pi '^\h*(allow|deny)(users|groups)\h+'
```

### Expected Result

At least one of `AllowUsers`, `AllowGroups`, `DenyUsers`, or `DenyGroups` should be set.

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set one or more of the following parameters:

```bash
AllowUsers <userlist>
AllowGroups <grouplist>
DenyUsers <userlist>
DenyGroups <grouplist>
```

## References

1. NIST SP 800-53 Rev. 5: AC-3, MP-2

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.

v7 - 14.6 Protect Information through Access Control Lists.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
