---
name: cis-apache24-11.3
description: "Ensure the httpd_t Type is Not in Permissive Mode (Automated)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, selinux, mac, permissive-mode]
cis_id: "11.3"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the httpd_t Type is Not in Permissive Mode (Automated)

## Profile Applicability
- Level 2

## Description

In addition to setting the entire SELinux configuration in permissive mode, it is possible to set individual process types (domains) such as `httpd_t` into a permissive mode as well. The permissive mode will not prevent any access or actions, instead, any actions that would have been denied are simply logged.

## Rationale

Usage of the permissive mode is helpful for testing and ensuring that SELinux will not prevent access that is necessary for the proper function of a web application. However, all access is allowed in permissive mode by SELinux.

## Audit

Perform the following steps to determine if the recommended state is implemented:

Check that the `httpd_t` process type (domain) is not in permissive mode with the `semodule` command. There should be no output if the type is not set to permissive.

```bash
# semodule -l | grep permissive_httpd_t
```

## Remediation

Perform the following to implement the recommended state:

If the `httpd_t` type is in permissive mode; the customized permissive mode should be deleted with the following `semanage` command.

```bash
# semanage permissive -d httpd_t
```

## Default Value

The `httpd_t` type is not in permissive mode by default.

## References

1. https://docs.redhat.com/en/documentation/Red_Hat_Enterprise_Linux/6/html/Security-Enhanced_Linux/sect-Security-Enhanced_Linux-Fixing_Problems-Permissive_Domains.html

## CIS Controls

**v8:**
- 2.5 Allowlist Authorized Software
  - Use technical controls, such as application allowlisting, to ensure that only authorized software can execute or be accessed. Reassess bi-annually, or more frequently.

**v7:**
- 3.3 Configure Data Access Control Lists
  - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.
- 2.7 Utilize Application Whitelisting
  - Utilize application whitelisting technology on all assets to ensure that only authorized software executes and all unauthorized software is blocked from executing on assets.

## Profile
- Level 2
