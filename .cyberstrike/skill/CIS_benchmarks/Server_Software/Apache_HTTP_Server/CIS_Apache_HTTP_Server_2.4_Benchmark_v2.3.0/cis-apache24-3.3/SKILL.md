---
name: cis-apache24-3.3
description: "Ensure the Apache User Account Is Locked"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.3"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.3 Ensure the Apache User Account Is Locked

## Profile Applicability
- Level 1

## Description

The user account under which Apache runs should not have a valid password, but should be locked.

## Rationale

As a defense-in-depth measure the Apache user account should be locked to prevent logins, and to prevent a user from su'ing to `apache` using the password. In general, there shouldn't be a need for anyone to have to su as `apache`, and when there is a need, then `sudo` should be used instead, which would not require the `apache` account password.

## Audit

Ensure the `apache` account is locked using the following:

```bash
# passwd -S apache
```

The results will be similar to the following:

```
apache LK 2010-01-28 0 99999 7 -1 (Password locked.)

- or -

apache L 07/02/2012 -1 -1 -1 -1
```

## Remediation

Use the `passwd` command to lock the `apache` account:

```bash
# passwd -l apache
```

## Default Value

The default user is `daemon` and the account is typically locked.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.3 Disable Dormant Accounts<br>Delete or disable any dormant accounts after a period of 45 days of inactivity, where supported. | ● | ● | ● |
| v7 | 16.8 Disable Any Unassociated Accounts<br>Disable any account that cannot be associated with a business process or business owner. | ● | ● | ● |

## Profile
- Level 1
