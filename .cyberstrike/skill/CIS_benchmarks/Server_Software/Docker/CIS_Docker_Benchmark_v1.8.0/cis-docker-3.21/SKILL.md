---
name: cis-docker-3.21
description: "Ensure that the /etc/sysconfig/docker file permissions are set to 644 or more restrictively"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, daemon-files, file-permissions, ownership]
cis_id: "3.21"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that the /etc/sysconfig/docker file permissions are set to 644 or more restrictively (Manual)

## Profile Applicability

- Level 2 - Docker - Linux

## Description

You should verify that the `/etc/sysconfig/docker` file permissions are correctly set to `644` or more restrictively.

## Rationale

The `/etc/sysconfig/docker` file contains sensitive parameters that may alter the behavior of the Docker daemon. It should therefore be writeable only by `root` in order to ensure that it is not modified by less privileged users.

## Impact

None.

## Audit Procedure

You should execute the command below to verify that the file permissions are correctly set to `644` or more restrictively:

```bash
stat -c %a /etc/sysconfig/docker
```

## Remediation

You should execute the following command:

```bash
chmod 644 /etc/sysconfig/docker
```

This sets the file permissions for this file to `644`.

## Default Value

This file may not be present on the system and in this case, this recommendation is not applicable.

## References

1. https://docs.docker.com/engine/admin/configuring/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |
