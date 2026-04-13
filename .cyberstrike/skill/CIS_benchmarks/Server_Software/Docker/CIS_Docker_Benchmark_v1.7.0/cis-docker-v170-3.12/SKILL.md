---
name: cis-docker-v170-3.12
description: "Ensure that the Docker server certificate file permissions are set to 444 or more restrictively"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, files, permissions, tls, certificates]
cis_id: "3.12"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 3.12

## Description

You should verify that the Docker server certificate file (the file that is passed along with the `--tlscert` parameter) has permissions of `444` or more restrictive permissions.

## Rationale

The Docker server certificate file should be protected from any tampering. It is used to authenticate the Docker server based on the given server certificate. It should therefore have permissions of `444` to prevent its modification.

## Impact

None.

## Audit Procedure

You should execute the command below to verify that the Docker server certificate file has permissions of `444` or more restrictive permissions:

```bash
stat -c %a <path to Docker server certificate file>
```

## Remediation

You should execute the command below:

```bash
chmod 444 <path to Docker server certificate file>
```

This sets the file permissions of the Docker server certificate file to `444`.

## Default Value

By default, the permissions for the Docker server certificate file might not be `444`. The default file permissions are governed by the operating system or user specific `umask` values.

## References

1. https://docs.docker.com/registry/insecure/
2. https://docs.docker.com/engine/security/https/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ● | ● | ● |
| v7 | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ● | ● | ● |

## Profile Applicability

- Level 1 - Docker - Linux

## Assessment Status

Manual
