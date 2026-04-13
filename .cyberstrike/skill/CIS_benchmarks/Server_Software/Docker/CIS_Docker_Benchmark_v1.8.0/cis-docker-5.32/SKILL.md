---
name: cis-docker-5.32
description: "Ensure that the Docker socket is not mounted inside any containers"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, runtime]
cis_id: "5.32"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.32 Ensure that the Docker socket is not mounted inside any containers (Manual)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

The Docker socket `docker.sock` should not be mounted inside a container.

## Rationale

If the Docker socket is mounted inside a container it could allow processes running within the container to execute Docker commands which would effectively allow for full control of the host.

## Impact

None

## Audit Procedure

You should run the following command:

```
docker ps --quiet --all | xargs docker inspect --format '{{ .Id }}: Volumes={{ .Mounts }}' | grep docker.sock
```

This would return any instances where `docker.sock` had been mapped to a container as a volume.

## Remediation

You should ensure that no containers mount `docker.sock` as a volume.

## Default Value

By default, `docker.sock` is not mounted inside containers.

## References

1. https://docs.docker.com/engine/reference/commandline/dockerd/#daemon-socket-option

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts<br>Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | ● | ● | ● |
| v7 | 4 Controlled Use of Administrative Privileges<br>Controlled Use of Administrative Privileges | | | |
