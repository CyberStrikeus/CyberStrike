---
name: cis-apache24-5.5
description: "Ensure the Default CGI Content printenv Script Is Removed"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options]
cis_id: "5.5"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.5 Ensure the Default CGI Content printenv Script Is Removed

## Profile Applicability

- Level 2

## Description

Most Web Servers, including Apache installations have default CGI content which is not needed or appropriate for production use. The primary function for these sample programs is to demonstrate the capabilities of the web server. One common default CGI content for Apache installations is the script `printenv`. This script will print back to the requester all of the CGI environment variables which includes many server configuration details and system paths.

## Rationale

CGI programs have a long history of security bugs and problems associated with improperly accepting user-input. Since these programs are often targets of attackers, we need to make sure that there are no unnecessary CGI programs that could potentially be used for malicious purposes. Usually these programs are not written for production use and consequently little thought was given to security in their development. The `printenv` script in particular will disclose inappropriate information about the web server including directory paths and detailed version and configuration information.

## Audit

Perform the following to determine if the recommended state is implemented:

1. Locate cgi-bin files and directories enabled in the Apache configuration via `Script`, `ScriptAlias` or `ScriptAliasMatch` directives.
2. Ensure the `printenv` CGI is not installed in any configured cgi-bin directory.

## Remediation

Perform the following to implement the recommended state:

1. Locate cgi-bin files and directories enabled in the Apache configuration via `Script`, `ScriptAlias`, `ScriptAliasMatch` directives.
2. Remove the `printenv`default CGI in cgi-bin directory if it is installed.

```bash
# rm $APACHE_PREFIX/cgi-bin/printenv
```

## Default Value

The default source installation includes the `printenv` script. However, this script is not executable by default.

## Profile

- Level 2 | Manual
