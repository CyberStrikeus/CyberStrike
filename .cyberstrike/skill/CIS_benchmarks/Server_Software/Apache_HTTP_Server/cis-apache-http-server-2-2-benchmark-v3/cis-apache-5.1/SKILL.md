---
name: cis-apache-5.1
description: "Ensure Options for the OS Root Directory Are Restricted"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options]
cis_id: "5.1"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Options for the OS Root Directory Are Restricted

## Description

The Apache `Options` directive allows for specific configuration of options, including execution of CGI, following symbolic links, server side includes, and content negotiation.

Refer to the Apache 2.2 documentation for details:
http://httpd.apache.org/docs/2.2/mod/core.html#options.

## Rationale

The `Options` directive for the root OS level is used to create a default minimal options policy that allows only the minimal options at the root directory level. Then for specific web sites or portions of the web site, options may be enabled as needed and appropriate. No options should be enabled and the value for the `Options` directive should be None.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the recommended state is implemented:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find a root `<Directory>` element.
2. Ensure there is a single `Options` directive with the value of None.

The following may be useful for extracting root directory elements from the Apache configuration for auditing:

```bash
perl -ne 'print if /^ *<Directory *\/i .. /<\/Directory/i'
$APACHE_PREFIX/conf/httpd.conf
```

## Remediation

Perform the following to implement the recommended state:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find a root `<Directory>` element.
2. Add a single `Options` directive if there is none.
3. Set the value for `Options` to None.

```apache
<Directory />
   . . .
   Options None
   . . .
</Directory>
```

## Default Value

The following is the default root directory configuration:

```apache
<Directory />
   Options FollowSymlinks
   . . .
</Directory>
```

## References

1. http://httpd.apache.org/docs/2.2/mod/core.html#options

## CIS Controls

Version 6

18 Application Software Security
Application Software Security

Version 7

5.1 Establish Secure Configurations
Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile

Level 1 | Scored
