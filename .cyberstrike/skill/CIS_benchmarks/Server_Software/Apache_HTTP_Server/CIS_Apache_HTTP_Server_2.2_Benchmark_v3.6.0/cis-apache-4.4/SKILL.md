---
name: cis-apache-4.4
description: "Ensure OverRide Is Disabled for All Directories"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, access-control, directory]
cis_id: "4.4"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure OverRide Is Disabled for All Directories

## Description

The Apache `AllowOverride` directive allows for `.htaccess` files to be used to override much of the configuration, including authentication, handling of document types, auto generated indexes, access control, and options. When the server finds an `.htaccess` file (as specified by `AccessFileName`), it needs to know which directives declared in that file can override earlier access information. When this directive is set to `None`, `.htaccess` files are completely ignored. When this directive is set to `All`, any directive which has the `.htaccess` Context is allowed in `.htaccess` files. Refer to the Apache 2.2 documentation for details http://httpd.apache.org/docs/2.2/mod/core.html#allowoverride.

## Rationale

While the functionality of `htaccess` files is sometimes convenient, usage decentralizes the access controls and increases the risk of configurations being changed or viewed inappropriately by an unintended or rogue `.htaccess` file. Consider also that some of the more common vulnerabilities in web servers and web applications allow the web files to be viewed or to be modified; this is why it is wise to keep the configuration of the web server from being placed in `.htaccess` files.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the recommended state is implemented:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find any `AllowOverride` directives.
2. Ensure the value for `AllowOverride` is None.

```bash
grep -i AllowOverride $APACHE_PREFIX/conf/httpd.conf
```

## Remediation

Perform the following to implement the recommended state:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find `AllowOverride` directives.
2. Set the value for all `AllowOverride` directives to None.

```apache
. . .
AllowOverride None
. . .
```

## References

1. https://httpd.apache.org/docs/2.2/mod/core.html#allowoverride

## CIS Controls

Version 6

14.4 Protect Information With Access Control Lists
All information stored on systems shall be protected with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

Version 7

14.6 Protect Information through Access Control Lists
Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile

Level 1 | Scored
