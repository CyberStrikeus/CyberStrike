---
name: cis-apache24-5.2
description: "Ensure Options for the Web Root Directory Are Restricted"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options]
cis_id: "5.2"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2 Ensure Options for the Web Root Directory Are Restricted

## Profile Applicability

- Level 2

## Description

The Apache `Options` directive allows for specific configuration of options, including:

- Execution of CGI
- Following symbolic links
- Server side includes
- Content negotiation

## Rationale

The `Options` directive at the web root or document root level also needs to be restricted to the minimal options required. A setting of `None` is highly recommended, however it is recognized that this level configuration may be needed if multiple languages are supported. No other options should be enabled.

## Audit

Perform the following to determine if the recommended state is implemented:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find document root `<Directory>` elements.
2. Ensure there is a single `Options` directive with the value of `None` or `Multiviews`.

The following may be useful in extracting directory elements from the Apache configuration for auditing.

```bash
perl -ne 'print if /^ *<Directory */\/i .. /<\/Directory>/i'
$APACHE_PREFIX/conf/httpd.conf
```

## Remediation

Perform the following to implement the recommended state:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find document root `<Directory>` element.
2. Add or modify any existing `Options` directive to have a value of `None` or `Multiviews`, if multiviews are needed.

```apache
<Directory "/usr/local/apache2/htdocs">
   . . .
   Options None
   . . .
```

## Default Value

The default value for the web root directory's `Option` directive is `FollowSymLinks`.

## References

1. https://httpd.apache.org/docs/2.4/mod/core.html#options

## CIS Controls

**Controls Version: v8**

- **5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts**
  - Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account.
  - **IG 1:** •
  - **IG 2:** •
  - **IG 3:** •

**Controls Version: v7**

- **4.7 Limit Access to Script Tools**
  - Limit access to scripting tools (such as Microsoft PowerShell and Python) to only administrative or development users with the need to access those capabilities.
  - **IG 2:** •
  - **IG 3:** •

## Profile

- Level 2 | Automated
