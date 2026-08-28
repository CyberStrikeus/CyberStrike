---
name: cis-ubuntu1804-v220-4-2-1
description: "Ensure permissions on /etc/ssh/sshd_config are configured"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, ssh, remote-access]
cis_id: "4.2.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.2.1

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `/etc/ssh/sshd_config` file contains configuration specifications for sshd. The command below sets the owner and group of the file to root.

## Rationale

The `/etc/ssh/sshd_config` file needs to be protected from unauthorized changes by non-privileged users.

## Audit Procedure

### Command Line

Run the following command and verify `Uid` and `Gid` are both `0/root` and `Access` does not grant permissions to `group` or `other`:

```bash
stat -c "%a %U %G" /etc/ssh/sshd_config
```

### Expected Result

```
600 root root
```

OR more restrictive.

## Remediation

### Command Line

Run the following commands to set ownership and permissions on `/etc/ssh/sshd_config`:

```bash
chown root:root /etc/ssh/sshd_config
chmod og-rwx /etc/ssh/sshd_config
```

## Default Value

Access: (0600/-rw-------) Uid: ( 0/ root) Gid: ( 0/ root)

## References

1. NIST SP 800-53 Rev. 5: AC-3, MP-2

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.

v7 - 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
