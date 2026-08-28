---
name: cis-apache-2.8
description: "Ensure the Info Module Is Disabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, modules, info]
cis_id: "2.8"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Info Module Is Disabled

## Description

The Apache `mod_info` module provides information on the server configuration via access to a `/server-info` URL location.

## Rationale

Although having server configuration information available as a web page may be convenient, it's recommended that this module be disabled. Once the module is loaded into the server, its handler capability is available in per-directory `.htaccess` files. This can leak sensitive information, such as system paths, usernames/passwords, and database names, from the configuration directives of other Apache modules.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the info module is disabled.

Run the `httpd` server with the `-M` option to list enabled modules:

```bash
# httpd -M | egrep 'info_module'
```

**Note**: If the module is correctly disabled, the only output when executing the above command should be `Syntax OK`.

## Remediation

Perform either one of the following to disable the `mod_info` module:

1. For source builds with static modules, run the Apache `./configure` script without including `mod_info` in the `--enable-modules= configure` script options.

```bash
$ cd $DOWNLOAD/httpd-2.2.22
$ ./configure
```

2. For dynamically loaded modules, comment out or remove the `LoadModule` directive for the `mod_info` module from the `httpd.conf` file.

```bash
##LoadModule info_module modules/mod_info.so
```

## Default Value

The module is disabled with a default source build.

## References

1. https://httpd.apache.org/docs/2.2/mod/mod_info.html

## CIS Controls

Version 6

9.1 Limit Open Ports, Protocols, and Services
Ensure that only ports, protocols, and services with validated business needs are running on each system.

Version 7

9.2 Ensure Only Approved Ports, Protocols and Services Are Running
Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Profile

Level 1 | Scored
Level 2 | Scored
