---
name: cis-apache24-2.3
description: "Ensure the WebDAV Modules Are Disabled"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, modules, webdav]
cis_id: "2.3"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.3 Ensure the WebDAV Modules Are Disabled (Automated)

## Profile Applicability
- Level 1

## Description
The Apache `mod_dav` and `mod_dav_fs` modules support WebDAV ('Web-based Distributed Authoring and Versioning') functionality for Apache. WebDAV is an extension to the HTTP protocol which allows clients to create, move, and delete files and resources on the web server.

## Rationale
Disabling WebDAV modules will improve the security posture of the web server by reducing the amount of potentially vulnerable code paths exposed to the network and reducing potential for unauthorized access to files via misconfigured WebDAV access controls.

## Audit
Perform the following to determine if the WebDAV modules are enabled.

Run the `httpd` server with the `-M` option to list enabled modules:

```bash
# httpd -M | grep ' dav_'[:print:]]+module'
```

**Note**: If the WebDAV modules are correctly disabled, there will be no output when executing the above command.

## Remediation
Perform either one of the following to disable WebDAV module:

1. For source builds with static modules run the Apache `./configure` script without including the `mod_dav`, and `mod_dav_fs` in the `--enable-modules=configure` script options.
   - `$ cd $DOWNLOAD_HTTPD`
   - `$ ./configure`
4. For dynamically loaded modules comment out or remove the LoadModule directive for `mod_dav`, and `mod_dav_fs` modules from the `httpd.conf` file.
   - `##LoadModule dav_module modules/mod_dav.so`
   - `##LoadModule dav_fs_module modules/mod_dav_fs.so`

## Default Value
The WebDAV modules are not enabled with a default source build.

## References
1. https://httpd.apache.org/docs/2.4/mod/mod_dav.html

## CIS Controls
- v8: 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile
- Level 1
