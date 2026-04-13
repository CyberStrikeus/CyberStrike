---
name: cis-apache24-5.10
description: "Ensure Access to .ht* Files Is Restricted"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options]
cis_id: "5.10"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Access to .ht* Files Is Restricted (Automated)

## Profile Applicability

Level 1

## Description

Restrict access to any files beginning with `.ht` using the `FilesMatch` directive.

## Rationale

The default name for access filename which allows files in web directories to override the Apache configuration is `.htaccess`. The usage of access files should not be allowed, but as a defense in depth a `FilesMatch` directive is recommended to prevent web clients from viewing those files in case they are created. Also a common name for web password and group files are `.htpasswd` and `.htgroup`. Neither of these files should be placed in the document root, but, in the event they are, the `FilesMatch` directive can be used to prevent them from being viewed by web clients.

## Impact

`.ht*` files are not accessible.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

Verify that a `FilesMatch` directive similar to the one below is present in the apache configuration and not commented out. The deprecated `Deny from All` directive may be used instead of the Require directive.

```
<FilesMatch "^\.ht">
    Require all denied
</FilesMatch>
```

## Remediation

Perform the following to implement the recommended state:

Add or modify the following lines in the Apache configuration file at the server configuration level.

```
<FilesMatch "^\.ht">
    Require all denied
</FilesMatch>
```

## Default Value

`.ht*` files are not accessible.

## References

1. https://httpd.apache.org/docs/2.4/mod/core.html#filesmatch

## CIS Controls

**v8:**
- 9.4 Restrict Unnecessary or Unauthorized Browser and Email Client Extensions
  - Restrict, either through uninstalling or disabling, any unauthorized or unnecessary browser or email client plugins, extensions, and add-on applications.

**v7:**
- 18.2 Ensure Explicit Error Checking is Performed for All In-house Developed Software
  - For in-house developed software, ensure that explicit error checking is performed and documented for all input, including for size, data type, and acceptable ranges or formats.
