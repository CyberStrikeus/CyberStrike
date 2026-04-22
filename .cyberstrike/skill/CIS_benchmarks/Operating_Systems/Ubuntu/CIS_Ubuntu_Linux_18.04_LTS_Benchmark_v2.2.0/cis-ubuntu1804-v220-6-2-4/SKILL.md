---
name: cis-ubuntu1804-v220-6-2-4
description: "Ensure shadow group is empty"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, groups]
cis_id: "6.2.4"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.4 Ensure shadow group is empty (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The shadow group allows system programs which require access the ability to read the `/etc/shadow` file. No users should be assigned to the shadow group.

## Rationale

Any users assigned to the shadow group would be granted read access to the `/etc/shadow` file. If attackers can gain read access to the `/etc/shadow` file, they can easily run a password cracking program against the hashed passwords to break them. Other security information that is stored in the `/etc/shadow` file (such as expiration) could also be useful to subvert additional user accounts.

## Audit Procedure

### Command Line

Run the following commands and verify no results are returned:

```bash
# awk -F: '($1=="shadow") {print $NF}' /etc/group
# awk -F: '($4 == '"$(getent group shadow | awk -F: '{print $3}' | xargs)"') {print " - user: \"" $1 "\" primary group is the shadow group"}' /etc/passwd
```

## Expected Result

No output should be returned.

## Remediation

### Command Line

Run the following command to remove all users from the shadow group:

```bash
# sed -ri 's/(^shadow:[^:]*:[^:]*:[^:]*|[^:]+$)/\1/' /etc/group
```

Change the primary group of any users with shadow as their primary group.

```bash
# usermod -g <primary group> <user>
```

## References

1. NIST SP 800-53 Rev. 5: IA-5

## CIS Controls

- v8: **3.3** Configure Data Access Control Lists
- v7: **14.6** Protect Information through Access Control Lists
