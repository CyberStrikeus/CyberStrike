---
name: cis-apache24-2.8
description: "Ensure the Info Module Is Disabled"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, modules, info]
cis_id: "2.8"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.8 Ensure the Info Module Is Disabled (Automated)

## Profile Applicability
- Level 1

## Description
The Apache `mod_info` module provides information on the server configuration via access to a `/server-info` URL location.

## Rationale
While having server configuration information available as a web page may be convenient it's recommended that this module NOT be enabled. Once `mod_info` is loaded into the server, its handler capability is available in all per-directory `.htaccess` files and can leak sensitive information from the configuration directives of other Apache modules such as system paths, usernames/passwords, database names, etc.

## Audit
Perform the following to determine if the Info module is enabled.

Run the `httpd` server with the `-M` option to list enabled modules:

```bash
# httpd -M | egrep 'info_module'
```

**Note**: If the module is correctly disabled, there will be no output when executing the above command.

## Remediation
Perform either one of the following to disable the `mod_info` module:

1. For source builds with static modules, run the Apache `./configure` script without including the `mod_info` in the `--enable-modules= configure` script options.
   - `$ cd $DOWNLOAD_HTTPD`
   - `$ ./configure`
4. For dynamically loaded modules, comment out or remove the LoadModule directive for the `mod_info` module from the `httpd.conf` file.
   - `##LoadModule info_module modules/mod_info.so`

## Default Value
The `mod_info` module is not enabled with a default source build.

## References
1. https://httpd.apache.org/docs/2.4/mod/mod_info.html

## CIS Controls
- v8: 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile
- Level 1
