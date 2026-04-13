---
name: cis-apache-4.1
description: "Ensure Access to OS Root Directory Is Denied By Default"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, access-control, directory]
cis_id: "4.1"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Access to OS Root Directory Is Denied By Default

## Description

The Apache `Directory` directive allows for directory-specific configuration of access controls and many other features and options. One important usage is to create a default deny policy that does not allow access to OS directories and files, except for those specifically allowed. This is done by denying access to the OS root directory.

## Rationale

One aspect of Apache that is occasionally misunderstood is the feature of default access. That is, unless you take steps to change it, if the server can find its way to a file through normal URL mapping rules, it can and will serve it to clients. Having a default deny helps prevent unintended access. The Order directive is important as it provides for other Allow directives to override the default deny.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the recommended state is implemented:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find a root `<Directory>` element.
2. Ensure there is a single `Order` directive with the value of `deny, allow`.
3. Ensure there is a `Deny` directive and it has the value of `from all`.
4. Ensure there are no `Allow` or `Require` directives in the root `<Directory>` element.

The following may be useful in extracting root directory elements from the Apache configuration for auditing.

```bash
$ perl -ne 'print if /^ *<Directory *\*\/\//i .. /<\/Directory/i'
$APACHE_PREFIX/conf/httpd.conf
```

## Remediation

Perform the following to implement the recommended state:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find a root `<Directory>` element.
2. Have a single `Order` directive and set its value to `deny, allow`.
3. Have a `Deny` directive and set its value to `from all`.
4. Remove all `Allow` directives from the root `<Directory>` element.

```apache
<Directory />
   . . .
   Order deny,allow
   Deny from all
   . . .
</Directory>
```

## Default Value

The following is the default root directory configuration:

```apache
<Directory />
   . . .
   Order deny,allow
   Deny from all
</Directory>
```

## References

1. https://httpd.apache.org/docs/2.2/mod/core.html#directory
2. https://httpd.apache.org/docs/2.2/mod/mod_authz_host.html

## CIS Controls

Version 6

14.4 Protect Information With Access Control Lists
All information stored on systems shall be protected with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

Version 7

14.6 Protect Information through Access Control Lists
Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile

Level 1 | Scored
