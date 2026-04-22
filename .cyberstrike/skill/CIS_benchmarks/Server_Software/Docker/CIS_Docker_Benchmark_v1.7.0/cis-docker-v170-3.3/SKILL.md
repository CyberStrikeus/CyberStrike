---
name: cis-docker-v170-3.3
description: "Ensure that docker.socket file ownership is set to root:root"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, files, permissions, ownership, socket]
cis_id: "3.3"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 3.3

## Description

You should verify that the `docker.socket` file ownership and group ownership are correctly set to `root`.

## Rationale

The `docker.socket` file contains sensitive parameters that may alter the behavior of the Docker remote API. For this reason, it should be owned and group owned by `root` in order to ensure that it is not modified by less privileged users.

## Impact

None.

## Audit Procedure

### Step 1: Find out the file location

```bash
systemctl show -p FragmentPath docker.socket
```

### Step 2: If the file does not exist, this recommendation is not applicable. If the file exists, execute the command below, including the correct file path to verify that the file is owned and group-owned by `root`:

For example:

```bash
stat -c %U:%G /usr/lib/systemd/system/docker.socket | grep -v root:root
```

The command above should not return a value.

## Remediation

### Step 1: Find out the file location

```bash
systemctl show -p FragmentPath docker.socket
```

### Step 2: If the file does not exist, this recommendation is not applicable. If the file exists, execute the command below, including the correct file path to set the ownership and group ownership for the file to `root`:

For example:

```bash
chown root:root /usr/lib/systemd/system/docker.socket
```

## Default Value

This file may not be present on the system. In that case, this recommendation is not applicable. By default, if the file is present, the ownership and group ownership for it should be set to `root`.

## References

1. https://docs.docker.com/engine/reference/commandline/dockerd/#daemon-socket-option

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts<br>Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | ●    | ●    | ●    |
| v7               | 4 Controlled Use of Administrative Privileges<br>Controlled Use of Administrative Privileges                                                                                                                                                                                                                                  |      |      |      |

## Profile Applicability

- Level 1 - Docker - Linux

## Assessment Status

Automated
