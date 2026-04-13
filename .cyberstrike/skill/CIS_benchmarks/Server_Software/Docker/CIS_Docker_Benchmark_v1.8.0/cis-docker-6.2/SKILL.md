---
name: cis-docker-6.2
description: "Ensure that container sprawl is avoided"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, security-operations, sprawl]
cis_id: "6.2"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2 Ensure that container sprawl is avoided (Manual)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

You should not keep a large number of containers on the same host.

## Rationale

The flexibility of containers makes it easy to run multiple instances of applications and therefore indirectly leads to Docker images that can exist at varying security patch levels. It also means that you are consuming host resources that otherwise could have been used for running 'useful' containers. Having more than just an essential number of containers on a particular host makes the system vulnerable to mishandling, misconfiguration and fragmentation. You should therefore keep the number of containers on a given host to the minimum number commensurate with serving production applications.

## Impact

You should retain containers that are actively in use, and delete ones which are no longer needed.

## Audit Procedure

**Step 1** - Find the total number of containers you have on the host:

```
docker info --format '{{ .Containers }}'
```

**Step 2** - Execute the commands below to find the total number of containers that are actually running or in the stopped state on the host.

```
docker info --format '{{ .ContainersStopped }}'
docker info --format '{{ .ContainersRunning }}'
```

If the difference between the number of containers that are stopped on the host and the number of containers that are actually running is excessive, you may be suffering from "Container sprawl" and should review the unused containers for potential deletion.

## Remediation

You should periodically check your container inventory on each host and clean up containers which are not in active use with the command below:

```
docker container prune
```

## Default Value

By default, Docker does not restrict the number of containers you may have on a host.

## References

1. https://docs.docker.com/config/pruning/#prune-containers

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.12 Segment Data Processing and Storage Based on Sensitivity<br>Segment data processing and storage based on the sensitivity of the data. Do not process sensitive data on enterprise assets intended for lower sensitivity data. | | ● | ● |
| v8 | 4 Secure Configuration of Enterprise Assets and Software<br>Establish and maintain the secure configuration of enterprise assets (end-user devices, including portable and mobile; network devices; non-computing/IoT devices; and servers) and software (operating systems and applications). | | | |
| v7 | 5.1 Establish Secure Configurations<br>Maintain documented, standard security configuration standards for all authorized operating systems and software. | ● | ● | ● |
