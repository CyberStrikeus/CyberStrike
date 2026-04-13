---
name: cis-docker-v170-5.12
description: "Ensure that CPU priority is set appropriately on containers"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, runtime, configuration, resource-limits]
cis_id: "5.12"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: [CWE-400]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 5.12

## Profile Applicability
- Level 1 - Docker - Linux

## Description
By default, all containers on a Docker host share resources equally. By using the resource management capabilities of the Docker host you can control the host CPU resources that a container may consume.

## Rationale
By default, CPU time is divided between containers equally. If you wish to control available CPU resources amongst container instances, you can use the CPU sharing feature. CPU sharing allows you to prioritize one container over others and prevents lower priority containers from absorbing CPU resources which may be required by other processes. This ensures that high priority containers are able to claim the CPU runtime they require.

## Impact
If you do not correctly assign CPU thresholds, the container process may run out of resources and become unresponsive. If CPU resources on the host are not constrainted, CPU shares do not place any restrictions on individual resources.

## Audit Procedure

You should run the following command.

```bash
docker ps --quiet --all | xargs docker inspect --format='{{ .Id }}: CpuShares={{ .HostConfig.CpuShares }}'
```

If the above command returns `0` or `1024`, it means that CPU shares are not in place. If it returns a non-zero value other than `1024`, it means that they are in place.

## Remediation

You should manage the CPU runtime between your containers dependent on their priority within your organization. To do so start the container using the `--cpu-shares` argument.

For example, you could run a container as below:

```bash
docker run -d --cpu-shares 512 centos sleep 1000
```

In the example above, the container is started with CPU shares of 50% of what other containers use. So if the other container has CPU shares of 80%, this container will have CPU shares of 40%.

Every new container will have `1024` shares of CPU by default. However, this value is shown as `0` if you run the command mentioned in the audit section.

If you set one container's CPU shares to `512` it will receive half of the CPU time compared to the other containers. So if you take `1024` as 100% you can then derive the number that you should set for respective relative CPU shares. For example, use `512` if you want to set it to 50% and `256` if you want to set it 25%.

You can also view the current CPU shares in the file `/sys/fs/cgroup/cpu/docker/<CONTAINER_ID>/cpu.shares`.

## Default Value
By default, all containers on a Docker host share their resources equally. No CPU shares are enforced.

## References
1. https://docs.docker.com/config/containers/resource_constraints/#cpu
2. https://docs.docker.com/engine/reference/commandline/run/#options
3. https://docs.docker.com/engine/admin/runmetrics/

## CIS Controls

**v8:**
- 3.12 Segment Data Processing and Storage Based on Sensitivity - Segment data processing and storage based on the sensitivity of the data. Do not process sensitive data on enterprise assets intended for lower sensitivity data.

**v7:**
- 18 Application Software Security - Application Software Security

## Assessment Status
Manual
