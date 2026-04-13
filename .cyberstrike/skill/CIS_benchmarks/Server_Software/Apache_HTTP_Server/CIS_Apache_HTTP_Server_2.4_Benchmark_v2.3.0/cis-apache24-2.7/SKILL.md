---
name: cis-apache24-2.7
description: "Ensure the User Directories Module Is Disabled"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, modules, userdir]
cis_id: "2.7"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.7 Ensure the User Directories Module Is Disabled (Automated)

## Profile Applicability
- Level 1

## Description
The `UserDir` directive must be disabled so that user home directories are not accessed via the web site with a tilde (~) preceding the username. The directive also sets the path name of the directory that will be accessed. For example:

- `http://example.com/~ralph/` might access a `public_html` sub-directory of ralph user's home directory
- The directive `UserDir ./` might map `~root` to the root directory (`/`).

## Rationale
The user directories should not be globally enabled since it allows anonymous access to anything users may want to share with other users on the network. Also consider that every time a new account is created on the system, there is potentially new content available via the web site.

## Audit
Perform the following to determine if the modules are enabled.

Run the `httpd` server with the `-M` option to list enabled modules:

```bash
# httpd -M | grep userdir
```

**Note**: If the modules are correctly disabled, there will be no output when executing the above command.

## Remediation
Perform either one of the following to disable the user directories module:

1. For source builds with static modules, run the Apache `./configure` script with the `--disable-userdir configure` script options.
   - `$ cd $DOWNLOAD_HTTPD`
   - `$ ./configure --disable-userdir`
4. For dynamically loaded modules, comment out or remove the LoadModule directive for `mod_userdir` module from the `httpd.conf` file.
   - `##LoadModule userdir_module modules/mod_userdir.so`

## Default Value
The `mod_userdir` module is not enabled with a default source build.

## References
1. https://httpd.apache.org/docs/2.4/mod/mod_userdir.html

## CIS Controls
- v8: 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile
- Level 1
