---
name: cis-docker-v170-3.19
description: "Ensure that the /etc/default/docker file ownership is set to root:root"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, files, permissions, ownership, configuration]
cis_id: "3.19"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 3.19

## Description

You should verify that the `/etc/default/docker` file ownership and group-ownership is correctly set to `root`.

## Rationale

The `/etc/default/docker` file contains sensitive parameters that may alter the behavior of the Docker daemon. It should therefore be individually owned and group owned by `root` to ensure that it cannot be modified by less privileged users.

## Impact

None.

## Audit Procedure

You should execute the command below to verify that the file is individually owned and group owned by `root`:

```bash
stat -c %U:%G /etc/default/docker | grep -v root:root
```

The command above should return no results.

## Remediation

You should execute the following command

```bash
chown root:root /etc/default/docker
```

This sets the ownership and group ownership of the file to `root`.

## Default Value

This file may not be present on the system, and in this case, this recommendation is not applicable.

## References

1. https://docs.docker.com/engine/admin/configuring/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts<br>Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | ●    | ●    | ●    |
| v7               | 4 Controlled Use of Administrative Privileges<br>Controlled Use of Administrative Privileges                                                                                                                                                                                                                                  |      |      |      |

## Profile Applicability

- Level 2 - Docker - Linux

## Assessment Status

Manual
