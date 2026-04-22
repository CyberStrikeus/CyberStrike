---
name: cis-docker-v170-3.15
description: "Ensure that the Docker socket file ownership is set to root:docker"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, files, permissions, ownership, socket]
cis_id: "3.15"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 3.15

## Description

You should verify that the Docker socket file is owned by `root` and group owned by `docker`.

## Rationale

The Docker daemon runs as `root`. The default Unix socket therefore must be owned by `root`. If any other user or process owns this socket, it might be possible for that non-privileged user or process to interact with the Docker daemon. Additionally, in this case a non-privileged user or process might be able to interact with containers which is neither a secure nor desired behavior.

Additionally, the Docker installer creates a Unix group called `docker`. You can add users to this group, and in this case users would be able to read and write to the default Docker Unix socket. The membership of the `docker` group is tightly controlled by the system administrator. However, if any other group owns this socket, then it might be possible for members of that group to interact with the Docker daemon. Such a group might not be as tightly controlled as the `docker` group. Again, this is not in line with good security practice.

For these reason, the default Docker Unix socket file should be owned by `root` and group owned by `docker` to maintain the integrity of the socket file.

## Impact

None.

## Audit Procedure

You should execute the below command to verify that the Docker socket file is owned by `root` and group owned by `docker`:

```bash
stat -c %U:%G /var/run/docker.sock | grep -v root:docker
```

The command above should return no results.

## Remediation

You should execute the following command:

```bash
chown root:docker /var/run/docker.sock
```

This sets the ownership to `root` and group ownership to `docker` for the default Docker socket file.

## Default Value

By default, the ownership and group ownership for the Docker socket file is correctly set to `root:docker`.

## References

1. https://docs.docker.com/engine/reference/commandline/dockerd/#daemon-socket-option
2. https://docs.docker.com/engine/reference/commandline/dockerd/#bind-docker-to-another-hostport-or-a-unix-socket

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ●    | ●    | ●    |
| v7               | 4 Controlled Use of Administrative Privileges<br>Controlled Use of Administrative Privileges                                                                                                                                                     |      |      |      |

## Profile Applicability

- Level 1 - Docker - Linux

## Assessment Status

Automated
