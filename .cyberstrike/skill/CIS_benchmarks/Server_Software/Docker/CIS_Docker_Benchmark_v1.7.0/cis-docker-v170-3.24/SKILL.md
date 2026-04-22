---
name: cis-docker-v170-3.24
description: "Ensure that the Containerd socket file permissions are set to 660 or more restrictively"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, files, permissions, containerd, socket]
cis_id: "3.24"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 3.24

## Description

You should verify that the Containerd socket file has permissions of `660` or are configured more restrictively.

## Rationale

Only `root` and the members of the `root` group should be allowed to read and write to the default Containerd Unix socket. The Containerd socket file should therefore have permissions of `660` or more restrictive permissions.

## Impact

None.

## Audit Procedure

You should execute the command below to verify that the Docker socket file has permissions of `660` or more restrictive permissions

```bash
stat -c %a /run/containerd/containerd.sock
```

## Remediation

You should execute the command below.

```bash
chmod 660 /run/containerd/containerd.sock
```

This sets the file permissions of the Containerd socket file to `660`.

## Default Value

By default, the permissions for the Containerd socket file is correctly set to `660`.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |

## Profile Applicability

- Level 1 - Docker - Linux

## Assessment Status

Automated
