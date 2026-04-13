---
name: cis-docker-5.17
description: "Ensure that the host's IPC namespace is not shared"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, runtime, namespaces, ipc]
cis_id: "5.17"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.17 Ensure that the host's IPC namespace is not shared (Manual)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

IPC (POSIX/SysV IPC) namespace provides separation of named shared memory segments, semaphores and message queues. The IPC namespace on the host should therefore not be shared with containers and should remain isolated.

## Rationale

The IPC namespace provides separation of IPC between the host and containers. If the host's IPC namespace is shared with the container, it would allow processes within the container to see all of IPC communications on the host system. This would remove the benefit of IPC level isolation between host and containers. An attacker with access to a container could get access to the host at this level with, it would have major consequences. The IPC namespace should therefore not be shared between the host and its containers.

## Impact

Shared memory segments are used in order to accelerate interprocess communications, commonly in high-performance applications. If this type of application is containerized into multiple containers, you might need to share the IPC namespace of the containers in order to achieve high performance. Under these circumstances, you should still only share container specific IPC namespaces and not the host IPC namespace.

A container's IPC namespace can be shared with another container as shown below:

```
docker run --interactive --tty --ipc=container:e3a7a1a97c58 centos /bin/bash
```

## Audit Procedure

You should run the following command:

```
docker ps --quiet --all | xargs docker inspect --format '{{ .Id }}: IpcMode={{ .HostConfig.IpcMode }}'
```

If the command returns `host`, it means that the host IPC namespace is shared with the container. Any other result means that it is not shared, and that the system is therefore configured in line with good security practice.

## Remediation

You should not start a container with the `--ipc=host` argument. For example, do not start a container as below:

```
docker run --interactive --tty --ipc=host centos /bin/bash
```

## Default Value

By default, all containers have their IPC namespace enabled and host IPC namespace is not shared with any container.

## References

1. https://docs.docker.com/engine/reference/run/#ipc-settings---ipc
2. https://www.man7.org/linux/man-pages/man7/ipc_namespaces.7.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.12 Segment Data Processing and Storage Based on Sensitivity<br>Segment data processing and storage based on the sensitivity of the data. Do not process sensitive data on enterprise assets intended for lower sensitivity data. | | ● | ● |
| v7 | 14.1 Segment the Network Based on Sensitivity<br>Segment the network based on the label or classification level of the information stored on the servers, locate all sensitive information on separated Virtual Local Area Networks (VLANs). | | ● | ● |
