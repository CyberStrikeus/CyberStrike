---
name: cis-docker-v170-3.17
description: "Ensure that the daemon.json file ownership is set to root:root"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, files, permissions, ownership, configuration]
cis_id: "3.17"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 3.17

## Description

You should verify that the `daemon.json` file individual ownership and group ownership is correctly set to `root`, if it is in use.

## Rationale

The `daemon.json` file contains sensitive parameters that could alter the behavior of the docker daemon. It should therefore be owned and group owned by `root` to ensure it can not be modified by less privileged users.

## Impact

None.

## Audit Procedure

You should execute the command below to verify that the file is owned and group owned by `root`:

```bash
stat -c %U:%G /etc/docker/daemon.json | grep -v root:root
```

The command above should not return any results or, if there is no daemon.json file present it will return:

```
stat: cannot stat '/etc/docker/daemon.json': No such file or directory
```

## Remediation

If the daemon.json file is present, you should execute the command below:

```bash
chown root:root /etc/docker/daemon.json
```

This sets the ownership and group ownership for the file to `root`.

## Default Value

This file may not be present on the system, and in that case, this recommendation is not applicable.

## References

1. https://docs.docker.com/engine/reference/commandline/dockerd/#daemon-configuration-file

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts<br>Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | ●    | ●    | ●    |
| v7               | 4 Controlled Use of Administrative Privileges<br>Controlled Use of Administrative Privileges                                                                                                                                                                                                                                  |      |      |      |

## Profile Applicability

- Level 2 - Docker - Linux

## Assessment Status

Manual
