---
name: cis-ubuntu1604-v200-6-2-2
description: "Ensure password fields are not empty"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, user-management, maintenance]
cis_id: "6.2.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 6.2.2

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

An account with an empty password field means that anybody may log in as that user without providing a password.

## Rationale

All accounts must have passwords or be locked to prevent the account from being used by an unauthorized user.

## Audit Procedure

### Command Line

Run the following command and verify that no output is returned:

```bash
awk -F: '($2 == "" ) { print $1 " does not have a password "}' /etc/shadow
```

## Expected Result

No output should be returned.

## Remediation

### Command Line

If any accounts in the `/etc/shadow` file do not have a password, run the following command to lock the account until it can be determined why it does not have a password:

```bash
passwd -l <username>
```

Also, check to see if the account is logged in and investigate what it is being used for to determine if it needs to be forced off.

## Default Value

N/A

## References

N/A

## CIS Controls

| Controls Version | Control                                                                                                                                                                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v7               | 4.4 Use Unique Passwords<br/>Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system. |      |      |      |
