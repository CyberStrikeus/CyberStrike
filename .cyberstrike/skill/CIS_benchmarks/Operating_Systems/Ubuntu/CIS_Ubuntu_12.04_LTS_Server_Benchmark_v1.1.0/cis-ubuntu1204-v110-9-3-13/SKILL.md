---
name: cis-ubuntu1204-v110-9-3-13
description: "Limit Access via SSH"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, authentication, ssh, access-control]
cis_id: "9.3.13"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.3.13 Limit Access via SSH (Scored)

## Profile Applicability
- Level 1

## Description
There are several options available to limit which users and group can access the system via SSH. It is recommended that at least one of the following options be leveraged:

**AllowUsers** - The `AllowUsers` variable gives the system administrator the option of allowing specific users to `ssh` into the system. The list consists of comma separated user names. Numeric userIDs are not recognized with this variable. If a system administrator wants to restrict user access further by only allowing the allowed users to log in from a particular host, the entry can be specified in the form of user@host.

**AllowGroups** - The `AllowGroups` variable gives the system administrator the option of allowing specific groups of users to `ssh` into the system. The list consists of comma separated user names. Numeric groupIDs are not recognized with this variable.

**DenyUsers** - The `DenyUsers` variable gives the system administrator the option of denying specific users to `ssh` into the system. The list consists of comma separated user names. Numeric userIDs are not recognized with this variable. If a system administrator wants to restrict user access further by specifically denying a user's access from a particular host, the entry can be specified in the form of user@host.

**DenyGroups** - The `DenyGroups` variable gives the system administrator the option of denying specific groups of users to `ssh` into the system. The list consists of comma separated group names. Numeric groupIDs are not recognized with this variable.

## Rationale
Restricting which users can remotely access the system via SSH will help ensure that only authorized users access the system.

## Audit Procedure
### Using Command Line
To verify the correct SSH setting, run the following command and verify that the output is as shown:
```bash
grep "^AllowUsers" /etc/ssh/sshd_config
grep "^AllowGroups" /etc/ssh/sshd_config
grep "^DenyUsers" /etc/ssh/sshd_config
grep "^DenyGroups" /etc/ssh/sshd_config
```

## Expected Result
```
AllowUsers <userlist>
AllowGroups <grouplist>
DenyUsers <userlist>
DenyGroups <grouplist>
```
At least one of these directives should be configured.

## Remediation
### Using Command Line
Edit the `/etc/ssh/sshd_config` file to set one or more of the parameter as follows:
```bash
AllowUsers <userlist>
AllowGroups <grouplist>
DenyUsers <userlist>
DenyGroups <grouplist>
```

## Default Value
No user/group access restrictions are configured by default.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
