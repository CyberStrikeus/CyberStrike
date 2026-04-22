---
name: cis-docker-v170-3.7
description: "Ensure that registry certificate file ownership is set to root:root"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, files, permissions, ownership, registry, certificates]
cis_id: "3.7"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 3.7

## Description

You should verify that all the registry certificate files (usually found under `/etc/docker/certs.d/<registry-name>` directory) are individually owned and group owned by `root`.

## Rationale

The `/etc/docker/certs.d/<registry-name>` directory contains Docker registry certificates. These certificate files must be individually owned and group owned by `root` to ensure that less privileged users are unable to modify the contents of the directory.

## Impact

None.

## Audit Procedure

You should execute the command below to verify that the registry certificate files are individually owned and group owned by `root`:

```bash
stat -c %U:%G /etc/docker/certs.d/* | grep -v root:root
```

The above command should not return any value.

## Remediation

The following command could be executed:

```bash
chown root:root /etc/docker/certs.d/<registry-name>/*
```

This would set the individual ownership and group ownership for the registry certificate files to `root`.

## Default Value

By default, the individual ownership and group ownership for registry certificate files is correctly set to `root`.

## References

1. https://docs.docker.com/registry/insecure/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts<br>Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | ●    | ●    | ●    |
| v7               | 4 Controlled Use of Administrative Privileges<br>Controlled Use of Administrative Privileges                                                                                                                                                                                                                                  |      |      |      |

## Profile Applicability

- Level 1 - Docker - Linux

## Assessment Status

Manual
