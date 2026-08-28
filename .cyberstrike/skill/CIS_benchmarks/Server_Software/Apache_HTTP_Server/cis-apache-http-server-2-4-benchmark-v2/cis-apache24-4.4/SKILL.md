---
name: cis-apache24-4.4
description: "Ensure OverRide Is Disabled for All Directories"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, access-control]
cis_id: "4.4"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.4 Ensure OverRide Is Disabled for All Directories

## Profile Applicability

- Level 1

## Description

The Apache `AllowOverride` directive and the new `AllowOverrideList` directive allow for `.htaccess` files to be used to override much of the configuration, including authentication, handling of document types, auto generated indexes, access control, and options. When the server finds an `.htaccess` file (as specified by `AccessFileName`) it needs to know which directives declared in that file can override earlier access information. When this directive is set to `None`, then `.htaccess` files are completely ignored. In this case, the server will not even attempt to read `.htaccess` files in the filesystem. When this directive is set to `All`, then any directive which has the `.htaccess` context is allowed in `.htaccess` files.

## Rationale

`.htaccess` files decentralizes access control and increases the risk of server configuration being changed inappropriately.

## Audit

Perform the following to determine if the recommended state is implemented:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find any `AllowOverride` directives.
2. Ensure there the value for `AllowOverride` is `None`.
3. `grep -i AllowOverride $APACHE_PREFIX/conf/httpd.conf`
4. Ensure there are no `AllowOverrideList` directives present.

## Remediation

Perform the following to implement the recommended state:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find `AllowOverride` directives.
2. Set the value for all `AllowOverride` directives to `None`.
3. `. . .`
4. `AllowOverride None`
5. `. . .`
6. Remove any `AllowOverrideList` directives found.

## References

1. https://httpd.apache.org/docs/2.4/mod/core.html#allowoverride
2. https://httpd.apache.org/docs/2.4/mod/core.html#allowoverridelist

## CIS Controls

**Controls Version: v8**

- **3.3 Configure Data Access Control Lists**
  - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.
  - **IG 1:** •
  - **IG 2:** •
  - **IG 3:** •

**Controls Version: v7**

- **14.6 Protect Information through Access Control Lists**
  - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.
  - **IG 1:** •
  - **IG 2:** •
  - **IG 3:** •

## Profile

- Level 1 | Automated
