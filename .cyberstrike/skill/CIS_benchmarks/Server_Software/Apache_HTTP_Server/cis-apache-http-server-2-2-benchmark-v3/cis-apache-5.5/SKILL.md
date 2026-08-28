---
name: cis-apache-5.5
description: "Ensure the Default CGI Content printenv Script Is Removed"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options]
cis_id: "5.5"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Default CGI Content printenv Script Is Removed

## Description

Most web servers, including Apache installations, have default CGI content which is not needed or appropriate for production use. The primary function for these sample programs is to demonstrate the capabilities of the web server. One common default CGI content for apache installations is the script `printenv`. This script will print back to the requester all of the CGI environment variables, which include many server configuration details and system paths.

## Rationale

CGI programs have a long history of security bugs and problems associated with improperly accepting user input. Since these programs are often targets of attackers, we need to make sure there are no unnecessary CGI programs that could potentially be used for malicious purposes. Usually these programs were not written for production use, and consequently little thought was given to security in their development. The `printenv` script in particular will disclose inappropriate information about the web server, including directory paths and detailed version and configuration information.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the recommended state is implemented:

1. Locate cgi-bin files and directories enabled in the Apache configuration via the `Script`, `ScriptAlias`, `ScriptAliasMatch`, or `ScriptInterpreterSource` directives.
2. Ensure the `printenv` CGI is not installed in any configured cgi-bin directory.

## Remediation

Perform the following to implement the recommended state:

1. Locate cgi-bin files and directories enabled in the Apache configuration via the `Script`, `ScriptAlias`, `ScriptAliasMatch`, or `ScriptInterpreterSource` directives.
2. Remove the `printenv` default CGI in the cgi-bin directory if it is installed.

```bash
# rm $APACHE_PREFIX/cgi-bin/printenv
```

## Default Value

The default source build does not include the `printenv` script.

## Notes

None documented

## References

None documented

## CIS Controls

Version 6

18 Application Software Security
Application Software Security

Version 7

4.7 Limit Access to Script Tools
Limit access to scripting tools (such as Microsoft PowerShell and Python) to only administrative or development users with the need to access those capabilities.

## Profile

Level 1 | Scored
