---
name: cis-apache-5.2
description: "Ensure Options for the Web Root Directory Are Restricted"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options]
cis_id: "5.2"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Options for the Web Root Directory Are Restricted

## Description

The Apache `Options` directive allows for specific configuration of options, including execution of CGI, following symbolic links, server side includes, and content negotiation.

Refer to the Apache 2.2 documentation for details
http://httpd.apache.org/docs/2.2/mod/core.html#options.

## Rationale

The `Options` directive at the web root or document root level should be restricted to the minimal options required. A setting of None is highly recommended; however, at this level, content negotiation may be needed if multiple languages are supported. No other options should be enabled.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the recommended state is implemented:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find the document root `<Directory>` element.
2. Ensure there is a single `Options` directive with the value of None or Multiviews (if multiviews are needed).

The following may be useful in extracting root directory elements from the Apache configuration for auditing:

```bash
perl -ne 'print if /^ *<Directory *\/i .. /<\/Directory/i'
$APACHE_PREFIX/conf/httpd.conf
```

## Remediation

Perform the following to implement the recommended state:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find the document root `<Directory>` element.
2. Add or modify any existing `Options` directive to have a value of None or Multiviews, if multiviews are needed.

```apache
<Directory "/usr/local/apache2/htdocs">
   . . .
   Options None
   . . .
</Directory>
```

## Default Value

The following is the default document root directory configuration:

```apache
<Directory "/usr/local/apache2/htdocs">
   . . .
   Options Indexes FollowSymLinks
   . . .
</Directory>
```

## References

1. https://httpd.apache.org/docs/2.2/mod/core.html#options

## CIS Controls

Version 6

18 Application Software Security
Application Software Security

Version 7

5.1 Establish Secure Configurations
Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile

Level 1 | Scored
