---
name: cis-docker-5.5
description: "Ensure that privileged containers are not used"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, runtime, privileged, security]
cis_id: "5.5"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.5 Ensure that privileged containers are not used (Manual)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

Using the `--privileged` flag provides all Linux kernel capabilities to the container to which it is applied and therefore overwrites the `--cap-add` and `--cap-drop` flags. For this reason you should ensure that it is not used.

## Rationale

The `--privileged` flag provides all capabilities to the container to which it is applied, and also lifts all the limitations enforced by the device cgroup controller. As a consequence this the container has most of the rights of the underlying host. This flag only exists to allow for specific use cases (for example running Docker within Docker) and should not generally be used.

## Impact

If you start a container without the `--privileged` flag, it will not have excessive default capabilities.

## Audit Procedure

You should run the command below:

```bash
docker ps --quiet --all | xargs docker inspect --format='{{ .Id }}: Privileged={{ .HostConfig.Privileged }}'
```

The above command should return `Privileged=false` for each container instance.

## Remediation

You should not run containers with the `--privileged` flag.

For example, do not start a container using the command below:

```bash
docker run --interactive --tty --privileged centos /bin/bash
```

## Default Value

False.

## References

1. https://docs.docker.com/engine/reference/run/#runtime-privilege-and-linux-capabilities

## CIS Controls

### v8

**5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts**

Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account.

### v7

**4 Controlled Use of Administrative Privileges**

Controlled Use of Administrative Privileges
