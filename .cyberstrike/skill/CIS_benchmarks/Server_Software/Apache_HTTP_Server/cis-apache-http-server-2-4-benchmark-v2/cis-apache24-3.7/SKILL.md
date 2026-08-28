---
name: cis-apache24-3.7
description: "Ensure the Core Dump Directory Is Secured"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.7"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.7 Ensure the Core Dump Directory Is Secured

## Profile Applicability

- Level 1

## Description

The `CoreDumpDirectory` directive is used to specify the directory Apache attempts to switch to before creating the core dump. Core dumps will be disabled if the directory is not writable by the Apache user. Also, core dumps will be disabled if the server is started as root and switches to a non-root user, as is typical. It is recommended that the `CoreDumpDirectory` directive be set to a directory that is owned by the root user, owned by the group the Apache HTTPD process executes as, and be inaccessible to other users.

## Rationale

Core dumps are snapshots of memory and may contain sensitive information that should not be accessible by other accounts on the system.

## Audit

Verify that either the `CoreDumpDirectory` directive is not enabled in any of the Apache configuration files or that the configured directory meets the following requirements:

1. `CoreDumpDirectory` is not within the Apache web document root (`$APACHE_PREFIX/htdocs`)
2. Must be owned by root and have a group ownership of the Apache group (as defined via the Group directive)
3. Must have no read-write-search access permission for other users. (e.g. `o=rwx`)

## Remediation

Either remove the `CoreDumpDirectory` directive from the Apache configuration files or ensure that the configured directory meets the following requirements.

1. `CoreDumpDirectory` is not to be within the Apache web document root (`$APACHE_PREFIX/htdocs`)
2. Must be owned by root and have a group ownership of the Apache group (as defined via the Group directive)
3. `# chown root:apache /var/log/httpd`
4. Must have no read-write-search access permission for other users.
5. `# chmod o-rwx /var/log/httpd`

## Default Value

The default core dump directory is the `ServerRoot` directory.

## References

1. https://httpd.apache.org/docs/2.4/mod/mpm_common.html#coredumpdirectory

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |

## Profile

- Level 1 | Manual
