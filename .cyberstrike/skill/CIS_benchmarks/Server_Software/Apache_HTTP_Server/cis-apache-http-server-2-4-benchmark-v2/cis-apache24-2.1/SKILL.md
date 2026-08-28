---
name: cis-apache24-2.1
description: "Ensure Only Necessary Authentication and Authorization Modules Are Enabled"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, modules, authentication]
cis_id: "2.1"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1 Ensure Only Necessary Authentication and Authorization Modules Are Enabled (Manual)

## Profile Applicability

- Level 1

## Description

The Apache 2.4 modules for authentication and authorization are grouped and named to provide both granularity and a consistent naming convention to simplify configuration. The `authn_*` modules provide authentication, while the `authz_*` modules provide authorization. Apache provides two types of authentication - basic and digest. Review the Apache Authentication and Authorization how-to documentation https://httpd.apache.org/docs/2.4/howto/auth.html and enable only the modules that are required.

## Rationale

Authentication and authorization are the front doors to the protected information in your web site. Most installations only need a small subset of the modules available. By minimizing the enabled modules to those that are actually used, we reduce the number of "doors" and therefore reduce the attack surface of the web site. Likewise, having fewer modules means less software that could have vulnerabilities.

## Audit

1. Use the `httpd -M` option as root to check which `auth*` modules are loaded.
2. `# httpd -M | egrep 'auth'`
3. Also use the `httpd -M` option as root to check for any LDAP modules which don't follow the same naming convention.
4. `# httpd -M | egrep 'ldap'`

The above commands should generate a `Syntax OK` message to stderr, in addition to a list of modules installed to stdout. If the `Syntax OK` message is missing, then there was most likely an error in parsing the configuration files.

## Remediation

Consult Apache module documentation for descriptions of each module in order to determine the necessary modules for the specific installation. https://httpd.apache.org/docs/2.4/mod/ The unnecessary static compiled modules are disabled through compile time configuration options as documented in https://httpd.apache.org/docs/2.4/programs/configure.html. The dynamically loaded modules are disabled by commenting out or removing the LoadModule directive from the Apache configuration files (typically httpd.conf). Some modules may be separate packages, and may be removed.

## Default Value

The following modules are loaded by a default source build:

- `authn_file_module (shared)`
- `authn_core_module (shared)`
- `authz_host_module (shared)`
- `authz_groupfile_module (shared)`
- `authz_user_module (shared)`
- `authz_core_module (shared)`

## References

1. https://httpd.apache.org/docs/2.4/howto/auth.html
2. https://httpd.apache.org/docs/2.4/mod/
3. https://httpd.apache.org/docs/2.4/programs/configure.html

## CIS Controls

- v8: 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 16.1 Maintain an Inventory of Authentication Systems
- v6: 16 Account Monitoring and Control

## Profile

- Level 1
