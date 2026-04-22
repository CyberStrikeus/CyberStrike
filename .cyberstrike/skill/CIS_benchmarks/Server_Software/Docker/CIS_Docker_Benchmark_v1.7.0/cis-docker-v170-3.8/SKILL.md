---
name: cis-docker-v170-3.8
description: "Ensure that registry certificate file permissions are set to 444 or more restrictively"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, files, permissions, registry, certificates]
cis_id: "3.8"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 3.8

## Description

You should verify that all the registry certificate files (usually found under `/etc/docker/certs.d/<registry-name>` directory) have permissions of `444` or are set more restrictively.

Note that, by default, this directory might not exist if no registry certificate files are in place.

## Rationale

The `/etc/docker/certs.d/<registry-name>` directory contains Docker registry certificates. These certificate files must have permissions of `444` or more restrictive permissions in order to ensure that unprivileged users do not have full access to them.

## Impact

None.

## Audit Procedure

You should execute the command below to verify that registry certificate files have permissions of `444` or are more restrictively set.

```bash
find /etc/docker/certs.d/ -type f -exec stat -c "%a %n" {} \;
```

## Remediation

You should execute the following command:

```bash
find /etc/docker/certs.d/ -type f -exec chmod 0444 {} \;
```

This would set the permissions for the registry certificate files to `444`.

## Default Value

By default, the permissions for registry certificate files might not be `444`. The default file permissions are governed by the system or user specific `umask` values which are defined within the operating system itself.

## References

1. https://docs.docker.com/registry/insecure/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |

## Profile Applicability

- Level 1 - Docker - Linux

## Assessment Status

Manual
