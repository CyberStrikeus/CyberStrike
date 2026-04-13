---
name: cis-docker-v170-3.5
description: "Ensure that the /etc/docker directory ownership is set to root:root"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, files, permissions, ownership, directory]
cis_id: "3.5"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 3.5

## Description

You should verify that the `/etc/docker` directory ownership and group ownership is correctly set to `root`.

## Rationale

The `/etc/docker` directory contains certificates and keys in addition to various other sensitive files. It should therefore be individual owned and group owned by `root` in order to ensure that it can not be modified by less privileged users.

## Impact

None.

## Audit Procedure

You should execute the command below to verify that the directory is owned and group owned by `root`:

```bash
stat -c %U:%G /etc/docker | grep -v root:root
```

This command should not return any data.

## Remediation

To resolve this issue you should run the following command:

```bash
chown root:root /etc/docker
```

This sets the ownership and group ownership for the directory to `root`.

## Default Value

By default, the ownership and group ownership for this directory is correctly set to `root`.

## References

1. https://docs.docker.com/engine/security/https/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts<br>Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | ● | ● | ● |
| v7 | 4 Controlled Use of Administrative Privileges<br>Controlled Use of Administrative Privileges | | | |

## Profile Applicability

- Level 1 - Docker - Linux

## Assessment Status

Automated
