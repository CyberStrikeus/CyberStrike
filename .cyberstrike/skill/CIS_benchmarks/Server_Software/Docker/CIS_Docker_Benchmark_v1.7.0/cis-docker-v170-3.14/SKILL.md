---
name: cis-docker-v170-3.14
description: "Ensure that the Docker server certificate key file permissions are set to 400"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, files, permissions, tls, certificates, keys]
cis_id: "3.14"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 3.14

## Description

You should verify that the Docker server certificate key file (the file that is passed along with the `--tlskey` parameter) has permissions of `400`.

## Rationale

The Docker server certificate key file should be protected from any tampering or unneeded reads. It holds the private key for the Docker server certificate. It must therefore have permissions of `400` to ensure that the certificate key file is not modified.

## Impact

None.

## Audit Procedure

You should execute the command below to verify that the Docker server certificate key file has permissions of `400`:

```bash
stat -c %a <path to Docker server certificate key file>
```

## Remediation

You should execute the following command:

```bash
chmod 400 <path to Docker server certificate key file>
```

This sets the Docker server certificate key file permissions to `400`.

## Default Value

By default, the permissions for the Docker server certificate key file might not be `400`. The default file permissions are governed by the operating system or user specific `umask` values.

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
