---
name: cis-apache-2.1
description: "Ensure Only Necessary Authentication and Authorization Modules Are Enabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, modules, authentication, authorization]
cis_id: "2.1"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Only Necessary Authentication and Authorization Modules Are Enabled

## Description

The Apache 2.2 modules for authentication and authorization have been refactored to provide finer granularity and more consistent and logical names, and to simplify configuration. The `authn_*` modules provide authentication, while the `authz_*` modules provide authorization. Apache provides two types of authentication: basic and digest. Enable only the modules that are required.

## Rationale

Authentication and authorization are the front doors to the protected information in your web site. Most installations only need a small subset of the modules available. By minimizing the enabled modules to those that are actually used, we reduce the number of "doors" and therefore reduce the attack surface of the web site. Likewise, having fewer modules means less software that could have vulnerabilities.

## Impact

None documented

## Audit Procedure

1. Use the `httpd -M` option as root to check which auth* modules are loaded.

```bash
# httpd -M | egrep 'auth.'
```

2. Use the `httpd -M` option as root to check for any LDAP modules which don't follow the same naming convention.

```bash
# httpd -M | egrep 'ldap'
```

The above commands should generate a `Syntax OK` message to stderr, in addition to a list of modules installed to stdout. If the `Syntax OK` message is missing, then there was most likely an error in parsing the configuration files.

## Remediation

Consult Apache module documentation for descriptions of each module in order to determine the necessary modules for the specific installation. The unnecessary static compiled modules are disabled through compile time configuration options. The dynamically loaded modules are disabled by commenting out or removing the `LoadModule` directive from the Apache configuration files (typically httpd.conf). Some modules may be separate packages and may be removed.

## Default Value

The following are the modules statically loaded for a default source build:

- `authn_file_module` (static)
- `authn_default_module` (static)
- `authz_host_module` (static)
- `authz_groupfile_module` (static)
- `authz_user_module` (static)
- `authz_default_module` (static)
- `auth_basic_module` (static)

## References

1. https://httpd.apache.org/docs/2.2/howto/auth.html
2. https://httpd.apache.org/docs/2.2/mod/
3. https://httpd.apache.org/docs/2.2/programs/configure.html

## CIS Controls

Version 6

16 Account Monitoring and Control
    Account Monitoring and Control

Version 7

16.1 Maintain an Inventory of Authentication Systems
    Maintain an inventory of each of the organization's authentication systems, including those located onsite or at a remote service provider.

## Profile

Level 1 | Not Scored
Level 2 | Not Scored
