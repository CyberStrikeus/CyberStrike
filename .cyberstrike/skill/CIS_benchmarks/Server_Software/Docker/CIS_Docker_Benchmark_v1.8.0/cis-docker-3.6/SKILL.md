---
name: cis-docker-3.6
description: "Ensure that /etc/docker directory permissions are set to 755 or more restrictively"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, daemon-files, file-permissions, ownership]
cis_id: "3.6"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that /etc/docker directory permissions are set to 755 or more restrictively (Automated)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

You should verify that the `/etc/docker` directory permissions are correctly set to `755` or more restrictively.

## Rationale

The `/etc/docker` directory contains certificates and keys in addition to various sensitive files. It should therefore only be writeable by `root` to ensure that it can not be modified by a less privileged user.

## Impact

None.

## Audit Procedure

You should execute the command below to verify that the directory has permissions of `755` or more restrictive ones:

```bash
stat -c %a /etc/docker
```

## Remediation

You should run the following command:

```bash
chmod 755 /etc/docker
```

This sets the permissions for the directory to `755`.

## Default Value

By default, the permissions for this directory are set to `755`.

## References

1. https://docs.docker.com/engine/security/https/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |
