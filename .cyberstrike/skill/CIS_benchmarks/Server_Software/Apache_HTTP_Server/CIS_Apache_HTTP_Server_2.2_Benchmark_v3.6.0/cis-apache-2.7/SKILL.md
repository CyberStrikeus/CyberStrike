---
name: cis-apache-2.7
description: "Ensure the User Directories Module Is Disabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, modules, userdir]
cis_id: "2.7"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the User Directories Module Is Disabled

## Description

The `UserDir` directive must be disabled so that user home directories are not accessed via the web site with a tilde (~) preceding the username. The directive also sets the path name of the directory that will be accessed. For example:

- `http://example.com/~ralph/` might access a `public_html` sub-directory of ralph user's home directory.
- The directive `UserDir ./` might map `/~root` to the root directory (`/`).

## Rationale

The user directories should not be globally enabled since that allows anonymous access to anything users may want to share with other users on the network. Also consider that every time a new account is created on the system, there is potentially new content available via the web site.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the user directories module is disabled.

Run the `httpd` server with the `-M` option to list enabled modules:

```bash
# httpd -M | grep userdir
```

**Note**: If the module is correctly disabled, the only output when executing the above command should be `Syntax OK`.

## Remediation

Perform either one of the following to disable the user directories module:

1. For source builds with static modules, run the Apache `./configure` script with the `--disable-userdir configure` script option.

```bash
$ cd $DOWNLOAD/httpd-2.2.22
$ ./configure --disable-userdir
```

2. For dynamically loaded modules, comment out or remove the `LoadModule` directive for the `mod_userdir` module from the `httpd.conf` file.

```bash
##LoadModule userdir_module modules/mod_userdir.so
```

## Default Value

The module is enabled with a default source build.

## References

1. https://httpd.apache.org/docs/2.2/mod/mod_userdir.html

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
