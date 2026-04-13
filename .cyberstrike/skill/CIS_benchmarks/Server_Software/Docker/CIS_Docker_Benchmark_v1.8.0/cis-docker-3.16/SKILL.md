---
name: cis-docker-3.16
description: "Ensure that the Docker socket file permissions are set to 660 or more restrictively"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, daemon-files, file-permissions, ownership]
cis_id: "3.16"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that the Docker socket file permissions are set to 660 or more restrictively (Automated)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

You should verify that the Docker socket file has permissions of `660` or are configured more restrictively.

## Rationale

Only `root` and the members of the `docker` group should be allowed to read and write to the default Docker Unix socket. The Docker socket file should therefore have permissions of `660` or more restrictive permissions.

## Impact

None.

## Audit Procedure

You should execute the command below to verify that the Docker socket file has permissions of `660` or more restrictive permissions

```bash
stat -c %a /var/run/docker.sock
```

## Remediation

You should execute the command below.

```bash
chmod 660 /var/run/docker.sock
```

This sets the file permissions of the Docker socket file to `660`.

## Default Value

By default, the permissions for the Docker socket file is correctly set to `660`.

## References

1. https://docs.docker.com/engine/reference/commandline/dockerd/#daemon-socket-option
2. https://docs.docker.com/engine/reference/commandline/dockerd/#bind-docker-to-another-hostport-or-a-unix-socket

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ● | ● | ● |
| v7 | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ● | ● | ● |
