---
name: cis-docker-v170-3.4
description: "Ensure that docker.socket file permissions are set to 644 or more restrictive"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, files, permissions, socket]
cis_id: "3.4"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 3.4

## Description

You should verify that the file permissions on the `docker.socket` file are correctly set to `644` or more restrictively.

## Rationale

The `docker.socket` file contains sensitive parameters that may alter the behavior of the Docker remote API. It should therefore be writeable only by `root` in order to ensure that it is not modified by less privileged users.

## Impact

None.

## Audit Procedure

### Step 1: Find out the file location

```bash
systemctl show -p FragmentPath docker.socket
```

### Step 2: If the file does not exist, this recommendation is not applicable. If the file exists, you should execute the command below, including the correct file path in order to verify that the file permissions are set to `644` or more restrictively:

For example:

```bash
stat -c %a /usr/lib/systemd/system/docker.socket
```

## Remediation

### Step 1: Find out the file location

```bash
systemctl show -p FragmentPath docker.socket
```

### Step 2: If the file does not exist, this recommendation is not applicable. If the file does exist, you should execute the command below, including the correct file path to set the file permissions to `644`:

For example:

```bash
chmod 644 /usr/lib/systemd/system/docker.socket
```

## Default Value

This file may not be present on the system and in that case, this recommendation is not applicable. By default, if the file is present, permissions should be set to 644 or more restrictively.

## References

1. https://docs.docker.com/engine/reference/commandline/dockerd/#bind-docker-to-another-hostport-or-a-unix-socket
2. https://github.com/YungSang/fedora-atomic-packer/blob/master/oem/docker.socket
3. http://daviddaeschler.com/2014/12/14/centos-7rhel-7-and-docker-containers-on-boot/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |

## Profile Applicability

- Level 1 - Docker - Linux

## Assessment Status

Automated
