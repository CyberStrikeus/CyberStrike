---
name: cis-apache-5.3
description: "Ensure Options for Other Directories Are Minimized"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options]
cis_id: "5.3"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Options for Other Directories Are Minimized

## Description

The Apache `Options` directive allows for specific configuration of options, including execution of CGI, following symbolic links, server side includes, and content negotiation.

Refer to the Apache 2.2 documentation for details
http://httpd.apache.org/docs/2.2/mod/core.html#options.

## Rationale

The options for other directories and hosts should be restricted to the minimal options required. A setting of None is recommended; however, it is recognized that other options may be needed in some cases:

• `Multiviews` is appropriate if content negotiation is required, such as when multiple languages are supported.
• `ExecCGI` is only appropriate for special directories dedicated to executable content, such as a cgi-bin/ directory. That way you will know what is executed on the server. It is possible to enable script execution based on file extension or permission settings, but this makes script control and management almost impossible as developers may install scripts without your knowledge.
• `FollowSymLinks` & `SymLinksIfOwnerMatch`: The following of symbolic links is not recommended and should be disabled if possible. The usage of symbolic links opens up additional risk for possible attacks that may use inappropriate symbolic links to access content outside of the document root of the web server. Also consider that it could be combined with a vulnerability that allows an attacker or insider to create an inappropriate link. The option `SymLinksIfOwnerMatch` is much safer in that the ownership must match in order for the link to be used, but keep in mind there is additional overhead created by the ownership check.
• `Includes` & `IncludesNOEXEC`: The `IncludesNOEXEC` option should only be needed when server side includes are required. The full `Includes` option should not be used because it allows execution of arbitrary shell commands. See Apache Mod Include for details http://httpd.apache.org/docs/2.2/mod/mod_include.html.
• `Indexes` causes automatic generation of indexes if the default index page is missing, so it should be disabled unless required.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the recommended state is implemented:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find all `<Directory>` elements.
2. Ensure that the `Options` directives do not enable `Includes`.
3. Ensure that all other options are set correctly.

The following may be useful for extracting directory elements from the Apache configuration for auditing:

```bash
perl -ne 'print if /^ *<Directory *\/i .. /<\/Directory/i'
$APACHE_PREFIX/conf/httpd.conf
```

or

```bash
grep -i -A 12 '<Directory[[:space:]]' $APACHE_PREFIX/conf/httpd.conf
```

## Remediation

Perform the following to implement the recommended state:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find all `<Directory>` elements.
2. Add or modify any existing `Options` directive to NOT have a value of `Includes`. Other options may be set if necessary and appropriate as described above.

## Default Value

```apache
<Directory "/usr/local/apache2/cgi-bin">
   . . .
   Options None
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
