---
name: cis-apache-11.3
description: "Ensure the httpd_t Type Is Not in Permissive Mode"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, selinux, mandatory-access-control, mac]
cis_id: "11.3"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the httpd_t Type Is Not in Permissive Mode

## Description

In addition to setting the entire SELinux configuration in permissive mode, it is possible to set individual process types (domains) such as `httpd_t` into permissive mode as well. Permissive mode will not prevent any access or actions; instead, any actions that would have been denied are simply logged.

## Rationale

Usage of permissive mode is helpful for testing and ensuring that SELinux will not prevent access that is necessary for the proper function of a web application. However, all access is allowed in permissive mode by SELinux.

## Impact

None documented

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

Check that the `httpd_t` process type (domain) is not in permissive mode with the `semodule` command. There should be no output if the type is not set to permissive.

```bash
# semodule -l | grep permissive_httpd_t
```

## Remediation

Perform the following to implement the recommended state:

If the `httpd_t` type is in permissive mode, the customized permissive mode should be deleted with the following `semanage` command.

```bash
# semanage permissive -d httpd_t
```

## Default Value

The `httpd_t` type is not in permissive mode by default.

## References

1. https://access.redhat.com/documentation/en-US/Red_Hat_Enterprise_Linux/6/html/Security-Enhanced_Linux/sect-Security-Enhanced_Linux-Fixing_Problems-Permissive_Domains.html

## CIS Controls

Version 6

14.4 Protect Information With Access Control Lists
All information stored on systems shall be protected with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

Version 7

14.6 Protect Information through Access Control Lists
Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile

Level 2 | Scored
