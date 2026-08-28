---
name: cis-apache-2.3
description: "Ensure the WebDAV Modules Are Disabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, modules, webdav]
cis_id: "2.3"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the WebDAV Modules Are Disabled

## Description

The Apache `mod_dav` and `mod_dav_fs` modules support WebDAV ('Web-based Distributed Authoring and Versioning') functionality for Apache. WebDAV is an extension to the HTTP protocol which allows clients to create, move, and delete files and resources on the web server.

## Rationale

WebDAV is not widely used, and it has serious security concerns because it may allow clients to modify unauthorized files on the web server. Therefore, the WebDav modules `mod_dav` and `mod_dav_fs` should be disabled.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the WebDAV modules are disabled.

Run the `httpd` server with the `-M` option to list enabled modules:

```bash
# httpd -M | grep ' dav_[[:print:]]+module'
```

**Note**: If the WebDav modules are correctly disabled, the only output when executing the above command should be `Syntax OK`.

## Remediation

Perform either one of the following to disable the WebDAV modules:

1. For source builds with static modules, run the Apache `./configure` script without including `mod_dav` and `mod_dav_fs` in the `--enable-modules=configure` script options.

```bash
$ cd $DOWNLOAD/httpd-2.2.22
$ ./configure
```

2. For dynamically loaded modules, comment out or remove the `LoadModule` directive for the `mod_dav` and `mod_dav_fs` modules from the `httpd.conf` file.

```bash
##LoadModule dav_module modules/mod_dav.so
##LoadModule dav_fs_module modules/mod_dav_fs.so
```

## Default Value

The modules are not enabled with a default source build.

## References

1. https://httpd.apache.org/docs/2.2/mod/mod_dav.html

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
