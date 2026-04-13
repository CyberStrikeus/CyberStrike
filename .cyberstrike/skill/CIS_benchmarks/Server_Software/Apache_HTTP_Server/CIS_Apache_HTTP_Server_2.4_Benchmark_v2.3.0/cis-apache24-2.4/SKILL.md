---
name: cis-apache24-2.4
description: "Ensure the Status Module Is Disabled"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, modules, status]
cis_id: "2.4"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.4 Ensure the Status Module Is Disabled (Automated)

## Profile Applicability
- Level 1

## Description
The Apache `mod_status` module provides current server performance statistics.

## Rationale
When `mod_status` is loaded into the server, its handler capability is available in all configuration files, including per-directory files (e.g., `.htaccess`). The `mod_status` module may provide an adversary with information that can be used to refine exploits that depend on measuring server load.

## Audit
Perform the following to determine if the Status module is enabled.

Run the `httpd` server with the `-M` option to list enabled modules:

```bash
# httpd -M | egrep 'status_module'
```

**Note**: If the modules are correctly disabled, there will be no output when executing the above command.

## Remediation
Perform either one of the following to disable the `mod_status` module:

1. For source builds with static modules, run the Apache `./configure` script with the `--disable-status configure` script options.
   - `$ cd $DOWNLOAD_HTTPD`
   - `$ ./configure --disable-status`
4. For dynamically loaded modules, comment out or remove the LoadModule directive for the `mod_status` module from the `httpd.conf` file.
   - `##LoadModule status_module modules/mod_status.so`

## Default Value
The `mod_status` module IS enabled with a default source build.

## References
1. https://httpd.apache.org/docs/2.4/mod/mod_status.html

## CIS Controls
- v8: 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile
- Level 1
