---
name: cis-docker-v170-5.31
description: "Ensure that the host's user namespaces are not shared"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, runtime, namespace, userns]
cis_id: "5.31"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 5.31

## Profile Applicability

- **Level:** 1
- **Type:** Manual
- **Platform:** Docker - Linux

## Description

You should not share the host's user namespaces with containers running on it.

## Rationale

User namespaces ensure that a root process inside the container will be mapped to a non-root process outside the container. Sharing the user namespaces of the host with the container does not therefore isolate users on the host from users in the containers.

## Impact

None

## Audit Procedure

You should run the command below and ensure that it does not return any value for `UsernsMode`. If it returns a value of `host`, it means that the host user namespace is shared with its containers.

```bash
docker ps --quiet --all | xargs docker inspect --format '{{ .Id }}: UsernsMode={{ .HostConfig.UsernsMode }}'
```

## Remediation

You should not share user namespaces between host and containers.

For example, you should not run the command below:

```bash
docker run --rm -it --userns=host ubuntu bash
```

## Default Value

By default, the host user namespace is shared with containers unless user namespace support is enabled.

## References

1. https://docs.docker.com/engine/security/userns-remap/
2. https://docs.docker.com/engine/reference/commandline/run/#options

## CIS Controls

**v8:**

- **3.12 Segment Data Processing and Storage Based on Sensitivity**
  - Segment data processing and storage based on the sensitivity of the data. Do not process sensitive data on enterprise assets intended for lower sensitivity data.

**v7:**

- **12 Boundary Defense**
  - Boundary Defense

**v7:**

- **14.1 Segment the Network Based on Sensitivity**
  - Segment the network based on the label or classification level of the information stored on the servers, locate all sensitive information on separated Virtual Local Area Networks (VLANs).
