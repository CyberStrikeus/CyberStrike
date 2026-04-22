---
name: cis-apache24-5.6
description: "Ensure the Default CGI Content test-cgi Script Is Removed"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options]
cis_id: "5.6"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.6 Ensure the Default CGI Content test-cgi Script Is Removed

## Profile Applicability

- Level 2

## Description

Most Web Servers, including Apache installations have default CGI content which is not needed or appropriate for production use. The primary function for these sample programs is to demonstrate the capabilities of the web server. A common default CGI content for Apache installations is the script `test-cgi`. This script will print back to the requester CGI environment variables which includes many server configuration details.

## Rationale

CGI programs have a long history of security bugs and problems associated with improperly accepting user-input. Since these programs are often targets of attackers, we need to make sure that there are no unnecessary CGI programs that could potentially be used for malicious purposes. Usually these programs are not written for production use and consequently little thought was given to security in their development. The `test-cgi` script in particular will disclose inappropriate information about the web server including directory paths and detailed version and configuration information.

## Audit

Perform the following to determine if the recommended state is implemented:

1. Locate cgi-bin files and directories enabled in the Apache configuration via `Script`, `ScriptAlias` or `ScriptAliasMatch` directives.
2. Ensure the `test-cgi` script is not installed in any configured `cgi-bin` directory.

## Remediation

Perform the following to implement the recommended state:

1. Locate cgi-bin files and directories enabled in the Apache configuration via `Script`, `ScriptAlias`, `ScriptAliasMatch` directives.
2. Remove the `test-cgi` default CGI in cgi-bin directory if it is installed.
3. `# rm $APACHE_PREFIX/cgi-bin/test-cgi`

## Default Value

The default source installation includes the test-cgi script. However, this script is not executable by default.

## References

1. https://httpd.apache.org/docs/2.4/mod/core.html#scriptinterpretersource

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 9.4 Restrict Unnecessary or Unauthorized Browser and Email Client Extensions<br>Restrict, either through uninstalling or disabling, any unauthorized or unnecessary browser or email client plugins, extensions, and add-on applications. |      | ●    | ●    |
| v7               | 4.7 Limit Access to Script Tools<br>Limit access to scripting tools (such as Microsoft PowerShell and Python) to only administrative or development users with the need to access those capabilities.                                     |      | ●    | ●    |
| v7               | 7.2 Disable Unnecessary or Unauthorized Browser or Email Client Plugins<br>Uninstall or disable any unauthorized browser or email client plugins or add-on applications.                                                                  |      | ●    | ●    |

## Profile

- Level 2 | Manual
