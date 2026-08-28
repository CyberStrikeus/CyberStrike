---
name: "CIS Ubuntu 14.04 LTS - 5.2.14 Ensure SSH access is limited"
description: "Verify SSH access is limited using AllowUsers, AllowGroups, DenyUsers, or DenyGroups directives"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - ssh
cis_id: "5.2.14"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 5.2.14 Ensure SSH access is limited (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

There are several options available to limit which users and group can access the system via SSH. It is recommended that at least one of the following options be leveraged:

- `AllowUsers` - gives the system administrator the option of allowing specific users to `ssh` into the system. The list consists of comma separated user names.
- `AllowGroups` - gives the system administrator the option of allowing specific groups of users to `ssh` into the system. The list consists of comma separated group names.
- `DenyUsers` - gives the system administrator the option of denying specific users to `ssh` into the system. The list consists of comma separated user names.
- `DenyGroups` - gives the system administrator the option of denying specific groups of users to `ssh` into the system. The list consists of comma separated group names.

## Rationale

Restricting which users can remotely access the system via SSH will help ensure that only authorized users access the system.

## Audit Procedure

Run the following commands and verify that output matches for at least one:

```bash
grep "^AllowUsers" /etc/ssh/sshd_config
grep "^AllowGroups" /etc/ssh/sshd_config
grep "^DenyUsers" /etc/ssh/sshd_config
grep "^DenyGroups" /etc/ssh/sshd_config
```

## Expected Result

At least one of the following should be configured:

```
AllowUsers <userlist>
AllowGroups <grouplist>
DenyUsers <userlist>
DenyGroups <grouplist>
```

## Remediation

Edit the `/etc/ssh/sshd_config` file to set one or more of the parameter as follows:

```
AllowUsers <userlist>
AllowGroups <grouplist>
DenyUsers <userlist>
DenyGroups <grouplist>
```

## Default Value

No restrictions by default.

## References

- CIS Controls: 5.1 - Minimize And Sparingly Use Administrative Privileges
- CIS Controls: 5.8 - Administrators Should Not Directly Log In To A System (i.e. use RunAs/sudo)

## Profile

- Level 1 - Server
- Level 1 - Workstation
