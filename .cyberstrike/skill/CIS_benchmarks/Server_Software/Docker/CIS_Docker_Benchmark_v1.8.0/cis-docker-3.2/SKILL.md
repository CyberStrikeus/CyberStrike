---
name: cis-docker-3.2
description: "Ensure that docker.service file permissions are appropriately set"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, daemon-files, file-permissions, ownership]
cis_id: "3.2"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that docker.service file permissions are appropriately set (Automated)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

You should verify that the `docker.service` file permissions are either set to `644` or to a more restrictive value.

## Rationale

The `docker.service` file contains sensitive parameters that may alter the behavior of the Docker daemon. It should therefore not be writable by any other user other than `root` in order to ensure that it can not be modified by less privileged users.

## Impact

None.

## Audit Procedure

**Step 1:** Find out the file location:

```bash
systemctl show -p FragmentPath docker.service
```

**Step 2:** If the file does not exist, this recommendation is not applicable. If the file exists, execute the command below, including the correct file path in order to verify that the file permissions are set to `644` or a more restrictive value.

For example:

```bash
stat -c %a /usr/lib/systemd/system/docker.service
```

## Remediation

**Step 1:** Find out the file location:

```bash
systemctl show -p FragmentPath docker.service
```

**Step 2:** If the file does not exist, this recommendation is not applicable. If the file exists, execute the command below including the correct file path to set the file permissions to `644`.

For example:

```bash
chmod 644 /usr/lib/systemd/system/docker.service
```

## Default Value

This file may not be present on the system. In that case, this recommendation is not applicable. By default, if the file is present, the file permissions are correctly set to `644`.

## References

1. https://docs.docker.com/articles/systemd/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |
