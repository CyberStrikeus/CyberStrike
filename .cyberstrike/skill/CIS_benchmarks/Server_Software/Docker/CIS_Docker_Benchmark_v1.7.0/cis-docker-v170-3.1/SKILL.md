---
name: cis-docker-v170-3.1
description: "Ensure that the docker.service file ownership is set to root:root"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, files, permissions, ownership]
cis_id: "3.1"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 3.1

## Description

You should verify that the `docker.service` file ownership and group ownership are correctly set to `root`.

## Rationale

The `docker.service` file contains sensitive parameters that may alter the behavior of the Docker daemon. It should therefore be individually and group owned by the `root` user in order to ensure that it is not modified or corrupted by a less privileged user.

## Impact

None.

## Audit Procedure

### Step 1: Find out the file location

```bash
systemctl show -p FragmentPath docker.service
```

### Step 2: If the file does not exist, this recommendation is not applicable. If the file exists, execute the command below including the correct file path in order to verify that the file is owned and group owned by `root`:

For example:

```bash
stat -c %U:%G /usr/lib/systemd/system/docker.service | grep -v root:root
```

The command above should not return anything.

## Remediation

### Step 1: Find out the file location

```bash
systemctl show -p FragmentPath docker.service
```

### Step 2: If the file does not exist, this recommendation is not applicable. If the file does exist, you should execute the command below, including the correct file path, in order to set the ownership and group ownership for the file to `root`:

For example:

```bash
chown root:root /usr/lib/systemd/system/docker.service
```

## Default Value

This file may not be present on the system and if it is not, this recommendation is not applicable. By default, if the file is present, the correct permissions are for the ownership and group ownership to be set to "root".

## References

1. https://docs.docker.com/config/daemon/systemd/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts<br>Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | ● | ● | ● |
| v7 | 4 Controlled Use of Administrative Privileges<br>Controlled Use of Administrative Privileges | | | |

## Profile Applicability

- Level 1 - Docker - Linux

## Assessment Status

Automated
