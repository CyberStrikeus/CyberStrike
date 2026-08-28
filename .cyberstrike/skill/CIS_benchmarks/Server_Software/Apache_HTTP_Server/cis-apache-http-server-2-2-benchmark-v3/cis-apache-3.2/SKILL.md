---
name: cis-apache-3.2
description: "Ensure the Apache User Account Has an Invalid Shell"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.2"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Apache User Account Has an Invalid Shell

## Description

The `apache` account must not be used as a regular login account, so it should be assigned an invalid or `nologin` shell to ensure it cannot be used to log in.

## Rationale

Service accounts such as the `apache` account are a risk if they can be used to get a login shell to the system.

## Impact

None documented

## Audit Procedure

Check the `apache` login shell in the `/etc/passwd` file:

```
# grep apache /etc/passwd
```

The apache account shell must be `/sbin/nologin` or `/dev/null`, similar to the following:

```
/etc/passwd:apache:x:48:48:Apache:/var/www:/sbin/nologin
```

## Remediation

Change the `apache` account to use the `nologin` shell or an invalid shell such as `/dev/null`:

```
# chsh -s /sbin/nologin apache
```

## Default Value

The default Apache user account is daemon with a shell of `/dev/null` or `/sbin/nologin`.

## References

None documented

## CIS Controls

### Version 6

16 Account Monitoring and Control

Account Monitoring and Control

### Version 7

4.3 Ensure the Use of Dedicated Administrative Accounts

Ensure that all users with administrative account access use a dedicated or secondary account for elevated activities. This account should only be used for administrative activities and not internet browsing, email, or similar activities.

## Profile

Level 1 | Scored
