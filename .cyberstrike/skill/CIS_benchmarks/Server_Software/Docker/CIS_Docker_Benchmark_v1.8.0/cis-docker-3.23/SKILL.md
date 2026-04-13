---
name: cis-docker-3.23
description: "Ensure that the Containerd socket file ownership is set to root:root"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, daemon-files, file-permissions, ownership]
cis_id: "3.23"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that the Containerd socket file ownership is set to root:root (Automated)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

You should verify that the Containerd socket file is owned by `root` and group owned by `root`.

## Rationale

Containerd is an underlying component used by Docker to create and manage containers. It provides a socket file similar to the Docker socket, which must be protected from unauthorized access. If any other user or process owns this socket, it might be possible for that non-privileged user or process to interact with the Containerd daemon. Additionally, in this case a non-privileged user or process might be able to interact with containers which is neither a secure nor desired behavior.

Unlike the Docker socket, there is usually no requirement for non-privileged users to connect to the socket, so the ownership should be root:root.

## Impact

None.

## Audit Procedure

You should execute the below command to verify that the Containerd socket file is owned by `root` and group owned by `root`:

```bash
stat -c %U:%G /run/containerd/containerd.sock | grep -v root:root
```

The command above should return no results.

## Remediation

You should execute the following command:

```bash
chown root:root /run/containerd/containerd.sock
```

This sets the ownership to `root` and group ownership to `root` for the default Containerd socket file.

## Default Value

By default, the ownership and group ownership for the Containerd socket file is correctly set to `root:root`.

## References

None specified in benchmark.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts - Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | ● | ● | ● |
| v7 | 4 Controlled Use of Administrative Privileges - Controlled Use of Administrative Privileges | | | |
