---
name: cis-docker-5.11
description: "Ensure that the memory usage for containers is limited"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, runtime, resources, memory, security]
cis_id: "5.11"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.11 Ensure that the memory usage for containers is limited (Manual)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

By default, all containers on a Docker host share resources equally. By using the resource management capabilities of the Docker host, you can control the amount of memory that a container is able to use.

## Rationale

By default a container can use all of the memory on the host. You can use memory limit mechanisms to prevent a denial of service occurring where one container consumes all of the host's resources and other containers on the same host therefore not able to function. Having no limit on memory usage can lead to issues where one container can easily make the whole system unstable and as a result unusable.

## Impact

If correct memory limits are not set on each container, one process can expand its usage and cause other containers to run out of resources.

## Audit Procedure

You should run the command below:

```bash
docker ps --quiet --all | xargs docker inspect --format='{{ .Id }}: Memory={{ .HostConfig.Memory }}'
```

If this command returns 0, it means that memory limits are not in place; if it returns a non-zero value, it means that they are in place.

## Remediation

You should run the container with only as much memory as it requires by using the `--memory` argument.

For example, you could run a container using the command below:

```bash
docker run -d --memory 256m centos sleep 1000
```

In the example above, the container is started with a memory limit of 256 MB.

Verify the memory settings by using the command below:

```bash
docker inspect --format='{{ .Id }}: Memory={{ .HostConfig.Memory }} KernelMemory={{ .HostConfig.KernelMemory }} Swap={{ .HostConfig.MemorySwap }}' <CONTAINER_ID>
```

## Default Value

By default, all containers on a Docker host share their resources equally and no memory limits are enforced.

## References

1. https://docs.docker.com/config/containers/resource_constraints/#limit-a-containers-access-to-memory
2. https://docs.docker.com/config/containers/runmetrics/

## CIS Controls

### v8

**3.12 Segment Data Processing and Storage Based on Sensitivity**

Segment data processing and storage based on the sensitivity of the data. Do not process sensitive data on enterprise assets intended for lower sensitivity data.

### v7

**18 Application Software Security**

Application Software Security
