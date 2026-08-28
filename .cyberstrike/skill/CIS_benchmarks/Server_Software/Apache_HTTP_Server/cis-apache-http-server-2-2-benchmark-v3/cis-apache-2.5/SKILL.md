---
name: cis-apache-2.5
description: "Ensure the Autoindex Module Is Disabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, modules, autoindex]
cis_id: "2.5"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Autoindex Module Is Disabled

## Description

The Apache `mod_autoindex` module automatically generates a web page listing the contents of directories on the server, typically used so an `index.html` does not have to be generated.

## Rationale

Automated directory listings should not be enabled because they will reveal information helpful to an attacker such as naming conventions and directory paths. They may also reveal files that were not intended to be revealed.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the `mod_autoindex` module is disabled.

Run the `httpd` server with the `-M` option to list enabled modules:

```bash
# httpd -M | grep autoindex_module
```

**Note**: If the module is correctly disabled, the only output when executing the above command should be `Syntax OK`.

## Remediation

Perform either one of the following to disable the `mod_autoindex` module:

1. For source builds with static modules, run the Apache `./configure` script with the `--disable-autoindex configure` script options.

```bash
$ cd $DOWNLOAD/httpd-2.2.22
$ ./configure --disable-autoindex
```

2. For dynamically loaded modules, comment out or remove the `LoadModule` directive for the `mod_autoindex` module from the `httpd.conf` file.

```bash
## LoadModule autoindex_module modules/mod_autoindex.so
```

## Default Value

The module is enabled with a default source build.

## References

1. https://httpd.apache.org/docs/2.2/mod/mod_autoindex.html

## CIS Controls

Version 6

18 Application Software Security
Application Software Security

Version 7

5.1 Establish Secure Configurations
Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile

Level 1 | Scored
Level 2 | Scored
