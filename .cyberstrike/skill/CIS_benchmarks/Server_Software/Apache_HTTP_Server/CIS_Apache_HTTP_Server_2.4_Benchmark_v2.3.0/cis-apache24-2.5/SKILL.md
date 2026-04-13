---
name: cis-apache24-2.5
description: "Ensure the Autoindex Module Is Disabled"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, modules, autoindex]
cis_id: "2.5"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.5 Ensure the Autoindex Module Is Disabled (Automated)

## Profile Applicability
- Level 1

## Description
The Apache `autoindex` module automatically generates web page listing the contents of directories on the server, typically used so that an `index.html` does not have to be generated.

## Rationale
Automated directory listings should not be enabled as it will also reveal information helpful to an attacker such as naming conventions and directory paths. Directory listings may also reveal files that were not intended to be revealed.

## Audit
Perform the following to determine if the module is enabled.

Run the `httpd` server with the `-M` option to list enabled modules:

```bash
# httpd -M | grep autoindex_module
```

**Note**: If the module is correctly disabled, there will be no output when executing the above command.

## Remediation
Perform either one of the following to disable the `mod_autoindex` module:

1. For source builds with static modules, run the Apache `./configure` script with the `--disable-autoindex` script options
   - `$ cd $DOWNLOAD_HTTPD`
   - `$ ./configure -disable-autoindex`
4. For dynamically loaded modules, comment out or remove the LoadModule directive for `mod_autoindex` from the `httpd.conf` file.
   - `## LoadModule autoindex_module modules/mod_autoindex.so`

## Default Value
The `mod_autoindex` module IS enabled with a default source build.

## References
1. https://httpd.apache.org/docs/2.4/mod/mod_autoindex.html

## CIS Controls
- v8: 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile
- Level 1
