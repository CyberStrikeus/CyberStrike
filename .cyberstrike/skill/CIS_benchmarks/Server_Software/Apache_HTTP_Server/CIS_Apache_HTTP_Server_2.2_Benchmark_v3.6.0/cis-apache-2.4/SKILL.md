---
name: cis-apache-2.4
description: "Ensure the Status Module Is Disabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, modules, status]
cis_id: "2.4"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Status Module Is Disabled

## Description

The Apache `mod_status` module provides current server performance statistics.

## Rationale

While having server performance status information available as a web page may be convenient, it's recommended that this module be disabled. When it is enabled, its handler capability is available in all configuration files, including per-directory files (e.g., `.htaccess`). This may have security-related ramifications.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the `mod_status` module is disabled.

Run the `httpd` server with the `-M` option to list enabled modules:

```bash
# httpd -M | egrep 'status_module'
```

**Note**: If the modules are correctly disabled, the only output when executing the above command should be `Syntax OK`.

## Remediation

Perform either one of the following to disable the `mod_status` module:

1. For source builds with static modules, run the Apache `./configure` script with the `--disable-status configure` script options.

```bash
$ cd $DOWNLOAD/httpd-2.2.22
$ ./configure --disable-status
```

2. For dynamically loaded modules, comment out or remove the `LoadModule` directive for the `mod_status` module from the `httpd.conf` file.

```bash
##LoadModule status_module modules/mod_status.so
```

## Default Value

The module is enabled with a default source build.

## References

1. https://httpd.apache.org/docs/2.2/mod/mod_status.html

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
