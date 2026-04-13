---
name: cis-apache24-4.2
description: "Ensure Appropriate Access to Web Content Is Allowed"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, access-control]
cis_id: "4.2"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2 Ensure Appropriate Access to Web Content Is Allowed

## Profile Applicability
- Level 1

## Description

In order to serve Web content, either the Apache `Allow` directive or the `Require` directive will need to be used to allow for appropriate access to directories, locations and virtual hosts that contain web content.

## Rationale

Either the `Allow` or `Require` directives may be used within a directory, a location or other context to allow appropriate access. Access may be allowed to all, or to specific networks, or hosts, or users as appropriate. The `Allow/Deny/Order` directives are deprecated and should be replaced by the `Require` directive. It is also recommended that either the `Allow` directive or the `Require` directive be used, but not both in the same context.

## Audit

Perform the following to determine if the recommended state is implemented:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find all `<Directory>` and `<Location>` elements.
2. Ensure that either one of the following two methods are configured:

**Use the deprecated Order/Deny/Allow method:**

1. Ensure there is a single `Order` directive with the value of `Deny,Allow` for each.
2. Ensure the `Allow` and `Deny` directives, have values that are appropriate for the purposes of the directory.

**Use the Require method:**

3. Ensure that the `Order/Deny/Allow` directives are **NOT** used for the directory.
4. Ensure the Require directives have values that are appropriate for the purposes of the directory.

The following command may be useful to extract `<Directory>` and `<Location>` elements and `Allow` directives from the Apache configuration files.

```bash
# perl -ne 'print if /^ *<Directory */i .. //<\/Directory>/i'
$APACHE_PREFIX/conf/httpd.conf $APACHE_PREFIX/conf.d/*.conf
# perl -ne 'print if /^ *<Location */i .. //<\/Location>/i'
$APACHE_PREFIX/conf/httpd.conf $APACHE_PREFIX/conf.d/*.conf
# grep -i -C 6 -i 'Allow[[:space:]|]from' $APACHE_PREFIX/conf/httpd.conf
$APACHE_PREFIX/conf.d/*.conf
```

## Remediation

Perform the following to implement the recommended state:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find all `<Directory>` and `<Location>` elements. There should be one for the document root and any special purpose directories or locations. There are likely to be access control directives in other contexts, such as virtual hosts or special elements like `<Proxy>`.
2. Include the appropriate `Require` directives, with values that are appropriate for the purposes of the directory.

The configurations below are just a few possible examples.

```apache
<Directory "/var/www/html/">
   Require ip 192.169.
</Directory>
<Directory "/var/www/html/">
   Require all granted
</Directory>
<Location /usage>
   Require local
</Location>
<Location /portal>
   Require valid-user
</Location>
```

## Default Value

The following is the default Web root directory configuration:

```apache
<Directory "/usr/local/apache2/htdocs">
   . . .
   Require all granted
   . . .
</Directory>
```

## References

1. https://httpd.apache.org/docs/2.4/howto/auth.html
2. https://httpd.apache.org/docs/2.4/mod/mod_authz_host.html
3. https://httpd.apache.org/docs/2.4/mod/mod_authz_core.html
4. https://httpd.apache.org/docs/2.4/mod/mod_access_compat.html
5. https://httpd.apache.org/docs/2.4/mod/core.html#directory

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
- Level 1 | Manual
