---
name: cis-apache24-5.11
description: "Ensure Access to .git Files Is Restricted"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options]
cis_id: "5.11"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Access to .git Files Is Restricted (Manual)

## Profile Applicability

Level 1

## Description

Restrict access to any files beginning with `.git` using the `FilesMatch` directive.

## Rationale

More and more websites track their changes in a Git repository we see a lot of attackers search for .git directories. Access to .git directories should be restricted. These files should be placed in the document root, but, in the event they are, the `FilesMatch` and `DirectoryMatch` directives can be used to prevent them from being viewed by web clients.

## Impact

`.git` files are not accessible.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

Verify that a `FilesMatch` and `DirectoryMatch` directives similar to the one below is present in the apache configuration and not commented out. The deprecated `Deny from All` directive may be used instead of the Require directive.

```
<FilesMatch "/\.git">
    Require all denied
</FilesMatch>

<DirectoryMatch "/\.git">
    Require all denied
</DirectoryMatch>
```

## Remediation

Perform the following to implement the recommended state:

Add or modify the following lines in the Apache configuration file at the server configuration level.

```
<FilesMatch "/\.git">
    Require all denied
</FilesMatch>

<DirectoryMatch "/\.git">
    Require all denied
</DirectoryMatch>
```

## Default Value

This is not set by default

## References

1. https://httpd.apache.org/docs/2.4/mod/core.html#filesmatch

## CIS Controls

**v8:**

- 9.4 Restrict Unnecessary or Unauthorized Browser and Email Client Extensions
  - Restrict, either through uninstalling or disabling, any unauthorized or unnecessary browser or email client plugins, extensions, and add-on applications.

**v7:**

- 18.2 Ensure Explicit Error Checking is Performed for All In-house Developed Software
  - For in-house developed software, ensure that explicit error checking is performed and documented for all input, including for size, data type, and acceptable ranges or formats.
