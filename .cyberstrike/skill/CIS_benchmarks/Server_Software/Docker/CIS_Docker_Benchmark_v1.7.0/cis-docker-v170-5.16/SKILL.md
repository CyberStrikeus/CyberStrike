---
name: cis-docker-v170-5.16
description: "Ensure that the host's process namespace is not shared"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, runtime, namespace, isolation]
cis_id: "5.16"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 5.16

## Profile Applicability
- **Level:** 1
- **Type:** Manual
- **Platform:** Docker - Linux

## Description

The Process ID (PID) namespace isolates the process ID space, meaning that processes in different PID namespaces can have the same PID. This creates process level isolation between the containers and the host.

## Rationale

PID namespace provides separation between processes. It prevents system processes from being visible, and allows process IDs to be reused including PID 1. If the host's PID namespace is shared with containers, it would basically allow these to see all of the processes on the host system. This reduces the benefit of process level isolation between the host and the containers. Under these circumstances a malicious user who has access to a container could get access to processes on the host itself, manipulate them, and even be able to kill them. This could allow for the host itself being shut down, which could be extremely serious, particularly in a multi-tenanted environment. You should not share the host's process namespace with the containers running on it.

## Impact

Container processes cannot see processes on the host system. In certain circumstances, you may want your container to share the host's process namespace. For example, you could build a container containing debugging tools such as `strace` or `gdb`, and want to use these tools when debugging processes on the host. If this is desired, then share specific host processes using the `-p` switch.

For example:
```bash
docker run --pid=host rhel7 strace -p 1234
```

## Audit Procedure

You should run the following command:

```bash
docker ps --quiet --all | xargs docker inspect --format '{{ .Id }}: PidMode={{ .HostConfig.PidMode }}'
```

If the command above returns `host`, it means that the host PID namespace is shared with its containers; any other result means that the system is configured in line with good security practice.

## Remediation

You should not start a container with the `--pid=host` argument.

For example, do not start a container as below:

```bash
docker run --interactive --tty --pid=host centos /bin/bash
```

## Default Value

By default, all containers have the PID namespace enabled and the therefore the host's process namespace is not shared with its containers.

## References

1. https://docs.docker.com/engine/reference/run/#pid-settings---pid
2. https://man7.org/linux/man-pages/man7/pid_namespaces.7.html

## CIS Controls

**v8:**
- **3.12 Segment Data Processing and Storage Based on Sensitivity**
  - Segment data processing and storage based on the sensitivity of the data. Do not process sensitive data on enterprise assets intended for lower sensitivity data.

**v7:**
- **14.1 Segment the Network Based on Sensitivity**
  - Segment the network based on the label or classification level of the information stored on the servers, locate all sensitive information on separated Virtual Local Area Networks (VLANs).
