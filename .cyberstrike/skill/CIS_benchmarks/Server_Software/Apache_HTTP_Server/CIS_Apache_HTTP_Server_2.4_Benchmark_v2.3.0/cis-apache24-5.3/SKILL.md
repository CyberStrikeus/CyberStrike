---
name: cis-apache24-5.3
description: "Ensure Options for Other Directories Are Minimized"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options]
cis_id: "5.3"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3 Ensure Options for Other Directories Are Minimized

## Profile Applicability
- Level 2

## Description

The Apache `Options` directive allows for specific configuration of options, including execution of CGI, following symbolic links, server side includes, and content negotiation.

## Rationale

Likewise, the options for other directories and hosts needs to be restricted to the minimal options required. A setting of `None` is recommended, however it is recognized that other options may be needed in some cases:

- **Multiviews** - Is appropriate if content negotiation is required, such as when multiple languages are supported.
- **ExecCGI** - Is only appropriate for special directories dedicated to executable content such as a `cgi-bin/` directory. That way you will know what is executed on the server. It is possible to enable CGI script control and management by file extension or permission settings, however this makes script control and management almost impossible as developers may install scripts without your knowledge. This may become a hosting environment.
- **FollowSymLinks** & **SymLinksIfOwnerMatch** - The following of symbolic links is not recommended and should be disabled if possible. The usage of symbolic links opens up additional risk for possible attacks that may use inappropriate symbolic links to access content outside of the document root of the web server. Also consider that it could be combined with a vulnerability that allowed an attacker or insider to create an inappropriate link. The option `SymLinksIfOwnerMatch` is much safer in that the ownership must match in order for the link to be used, however keep in mind there is additional overhead created by requiring Apache to check the ownership.
- **Includes** & **IncludesNOEXEC** - The `IncludesNOEXEC` option should only be needed when server side includes are required. The full `Includes` option should not be used as it also allows execution of arbitrary shell commands. See Apache Mod Include for details https://httpd.apache.org/docs/2.4/mod/mod_include.html
- **Indexes** - The `Indexes` option causes automatic generation of indexes, if the default index page is missing, and should be disabled unless required.

## Audit

Perform the following to determine if the recommended state is implemented:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find all `Directory` elements.
2. Ensure that the `Options` directives do not enable `Includes`.

The following may be useful for extracting `Directory` elements from the Apache configuration for auditing.

```bash
perl -ne 'print if /^ *<Directory */\/i .. /<\/Directory>/i'
$APACHE_PREFIX/conf/httpd.conf
```

or

```bash
grep -i -A 12 '<Directory[[:space:]|]' $APACHE_PREFIX/conf/httpd.conf
```

## Remediation

Perform the following to implement the recommended state:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find all `<Directory>` elements.
2. Add or modify any existing `Options` directive to NOT have a value of `Includes`. Other options may be set if necessary and appropriate as described above.

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
