---
name: cis-apache-3.7
description: "Ensure the Core Dump Directory Is Secured"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.7"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Core Dump Directory Is Secured

## Description

The `CoreDumpDirectory` directive can be used to specify a directory which Apache attempts to switch before dumping core. The default directory is the Apache `ServerRoot` directory. However, on Linux systems, core dumps are disabled by default. Most production environments should leave core dumps disabled. In the event that core dumps are needed, the directory needs to be writable by Apache, and it should meet the security requirements defined below in the audit and remediation sections.

## Rationale

Core dumps are snapshots of memory and may contain sensitive information that should not be accessible by other accounts on the system.

## Impact

None documented

## Audit Procedure

Verify that either the `CoreDumpDirectory` directive is not enabled in any of the Apache configuration files, or the configured directory meets the following requirements:

1. Not within the Apache web document root (`$APACHE_PREFIX/htdocs`)
2. Owned by root and has a group ownership of the Apache group (as defined via the Group directive)
3. Has no read-write-search access permission for other users (e.g., `o=rwx`)

## Remediation

Either remove the `CoreDumpDirectory` directive from the Apache configuration files, or make the configured directory meet the following requirements:

1. Not within the Apache web document root (`$APACHE_PREFIX/htdocs`)
2. Owned by root and has a group ownership of the Apache group (as defined via the Group directive)

```
# chown root:apache /var/log/httpd
```

3. Has no read-write-search access permission for other users

```
# chmod o-rwx /var/log/httpd
```

## Default Value

The default core dump directory is the `ServerRoot` directory, which should not be writable.

## References

1. https://httpd.apache.org/docs/2.2/mod/mpm_common.html#coredumpdirectory

## CIS Controls

### Version 6

18.9 Sanitize Deployed Software Of Development Artifacts

For in-house developed applications, ensure that development artifacts (sample data and scripts; unused libraries, components, debug code; or tools) are not included in the deployed software, or accessible in the production environment.

### Version 7

14.6 Protect Information through Access Control Lists

Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile

Level 1 | Scored
