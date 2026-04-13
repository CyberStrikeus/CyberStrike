---
name: cis-apache-3.3
description: "Ensure the Apache User Account Is Locked"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.3"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Apache User Account Is Locked

## Description

The user account under which Apache runs should not have a valid password, but should be locked.

## Rationale

As a defense-in-depth measure, the Apache user account should be locked to prevent logins and to prevent a user from su-ing to `apache` using the password. In general, there shouldn't be a need for anyone to have to su as `apache`, and when there is a need, `sudo` should be used instead, which would not require the `apache` account password.

## Impact

None documented

## Audit Procedure

Ensure the `apache` account is locked using the following:

```
# passwd -S apache
```

The results should be similar to the following:

```
apache LK 2010-01-28 0 99999 7 -1 (Password locked.)

- or -

apache L 07/02/2012 -1 -1 -1 -1
```

## Remediation

Use the `passwd` command to lock the `apache` account:

```
# passwd -l apache
```

## Default Value

The default user account, daemon, is locked by default.

## References

None documented

## CIS Controls

### Version 6

16 Account Monitoring and Control

Account Monitoring and Control

### Version 7

16.8 Disable Any Unassociated Accounts

Disable any account that cannot be associated with a business process or business owner.

## Profile

Level 1 | Scored

## Notes

The default user account, daemon, is locked by default.
