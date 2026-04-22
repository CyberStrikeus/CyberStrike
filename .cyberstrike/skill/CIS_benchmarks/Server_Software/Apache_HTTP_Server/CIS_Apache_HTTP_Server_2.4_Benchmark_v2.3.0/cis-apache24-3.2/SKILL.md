---
name: cis-apache24-3.2
description: "Ensure the Apache User Account Has an Invalid Shell"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.2"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.2 Ensure the Apache User Account Has an Invalid Shell

## Profile Applicability

- Level 1

## Description

The `apache` account must not be used as a regular login account, and should be assigned an invalid or `nologin` shell to ensure that the account cannot be used to login.

## Rationale

Service accounts such as the `apache` account represent a risk if they can be used to get a login shell to the system.

## Audit

Check the `apache` login shell in the `/etc/passwd` file:

```bash
# grep apache /etc/passwd
```

The `apache` account shell must be `/sbin/nologin` or `/dev/null` similar to the following:

```
/etc/passwd:apache:x:48:48:Apache:/var/www:/sbin/nologin
```

## Remediation

Change the `apache` account to use the `nologin` shell or an invalid shell such as `/dev/null`:

```bash
# chsh -s /sbin/nologin apache
```

## Default Value

The default Apache user account is `daemon`. The daemon account may have a valid login shell or a shell of `/sbin/nologin` depending on the operating system distribution version.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 2.6 Allowlist Authorized Libraries<br>Use technical controls to ensure that only authorized software libraries, such as specific .dll, .ocx, .so, etc., files, are allowed to load into a system process. Block unauthorized libraries from loading into a system process. Reassess bi-annually, or more frequently. |      | ●    | ●    |
| v7               | 2.7 Allowlist Authorized Scripts<br>Use technical controls, such as digital signatures and version control, to ensure that only authorized scripts, such as specific .ps1, .py, etc., files, are allowed to execute. Block unauthorized scripts from executing. Reassess bi-annually, or more frequently.            |      |      | ●    |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts<br>Ensure that all users with administrative account access use a dedicated or secondary account for elevated activities. This account should only be used for administrative activities and not internet browsing, email, or similar activities.            | ●    | ●    | ●    |

## Profile

- Level 1
