---
name: cis-docker-3.10
description: "Ensure that TLS CA certificate file permissions are set to 444 or more restrictively"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, daemon-files, file-permissions, ownership]
cis_id: "3.10"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that TLS CA certificate file permissions are set to 444 or more restrictively (Manual)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

You should verify that the TLS CA certificate file (the file that is passed along with the `--tlscacert` parameter) has permissions of `444` or is set more restrictively.

## Rationale

The TLS CA certificate file should be protected from any tampering. It is used to authenticate the Docker server based on a given CA certificate. It must therefore have permissions of `444`, or more restrictive permissions to ensure that the file cannot be modified by a less privileged user.

## Impact

None.

## Audit Procedure

You should execute the command below to verify that the TLS CA certificate file has permissions of `444` or that these are set more restrictively set:

```bash
stat -c %a <path to TLS CA certificate file>
```

## Remediation

You should execute the following command:

```bash
chmod 444 <path to TLS CA certificate file>
```

This sets the file permissions on the TLS CA file to `444`.

## Default Value

By default, the permissions for the TLS CA certificate file might not be `444`. The default file permissions are governed by the operating system or user specific `umask` values.

## References

1. https://docs.docker.com/registry/insecure/
2. https://docs.docker.com/engine/security/https/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ● | ● | ● |
| v7 | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ● | ● | ● |
