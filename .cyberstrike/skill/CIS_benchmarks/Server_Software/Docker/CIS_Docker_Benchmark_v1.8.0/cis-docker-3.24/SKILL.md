---
name: cis-docker-3.24
description: "Ensure that the Containerd socket file permissions are set to 660 or more restrictively"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, daemon-files, file-permissions, ownership]
cis_id: "3.24"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that the Containerd socket file permissions are set to 660 or more restrictively (Automated)

## Profile Applicability

- Level 1 - Docker - Linux

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

## References

None specified in benchmark.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ● | ● | ● |
