---
name: cis-apache-4.2
description: "Ensure Appropriate Access to Web Content Is Allowed"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, access-control, directory]
cis_id: "4.2"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Appropriate Access to Web Content Is Allowed

## Description

In order to serve web content, the Apache `Allow` directive will need to be used to allow for appropriate access to directories, locations, and virtual hosts that contain web content.

## Rationale

The `Allow` directive may be used within a directory, a location, or other context to allow appropriate access. Access may be allowed to all, or to specific networks, hosts, or users as appropriate.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the recommended state is implemented:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find all `<Directory>` elements.
2. Ensure there is a single `Order` directive with the value of `Deny, Allow` for each.
3. Ensure the `Allow` and `Deny` directives have values that are appropriate for the purposes of the directory.

The following commands may be useful to extract `<Directory>` and `<Location>` elements and `Allow` directives from the apache configuration files.

```bash
# perl -ne 'print if /^ *<Directory *\/i .. /<\/Directory/i'
$APACHE_PREFIX/conf/httpd.conf $APACHE_PREFIX/conf.d/*.conf

# perl -ne 'print if /^ *<Location *\/i .. /<\/Location/i'
$APACHE_PREFIX/conf/httpd.conf $APACHE_PREFIX/conf.d/*.conf

# grep -i -C 6 -i 'Allow[[:space:]]*from' $APACHE_PREFIX/conf/httpd.conf
$APACHE_PREFIX/conf.d/*.conf
```

## Remediation

Perform the following to implement the recommended state:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find all `<Directory>` and `<Location>` elements. There should be one for the document root and any special purpose directories or locations. There are likely to be other access control directives in other contexts, such as virtual hosts or special elements like `<Proxy>`.
2. Add a single `Order` directive and set the value to `deny, allow`.
3. Include the appropriate `Allow` and `Deny` directives, with values that are appropriate for the purposes of the directory.

The configurations below are just a few possible examples.

```apache
<Directory "/var/www/html/">
   Order deny,allow
   Deny from all
   Allow from 192.169.
</Directory>
```

```apache
<Directory "/var/www/html/">
   Order allow,deny
   Allow from all
</Directory>
```

```apache
<Location /usage>
   Order deny,allow
   Deny from all
   Allow from 127.0.0.1
   Allow from ::1
</Location>
```

## Default Value

The following is the default web root directory configuration:

```apache
<Directory "/usr/local/apache2/htdocs">
   . . .
   Order deny,allow
   Allow from all
</Directory>
```

## References

1. https://httpd.apache.org/docs/2.2/mod/core.html#require
2. https://httpd.apache.org/docs/2.2/mod/mod_authz_host.html
3. https://httpd.apache.org/docs/2.2/howto/auth.html

## CIS Controls

Version 6

14.4 Protect Information With Access Control Lists
All information stored on systems shall be protected with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

Version 7

14.6 Protect Information through Access Control Lists
Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile

Level 1 | Not Scored
