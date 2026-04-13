---
name: cis-docker-5.21
description: "Ensure that the host's UTS namespace is not shared"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, runtime, namespaces, uts]
cis_id: "5.21"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.21 Ensure that the host's UTS namespace is not shared (Manual)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

UTS namespaces provide isolation between two system identifiers: the hostname and the NIS domain name. It is used to set the hostname and the domain which are visible to running processes in that namespace. Processes running within containers do not typically require to know either the hostname or the domain name. The UTS namespace should therefore not be shared with the host.

## Rationale

Sharing the UTS namespace with the host provides full permission for each container to change the hostname of the host. This is not in line with good security practice and should not be permitted.

## Impact

None.

## Audit Procedure

You should run the following command:

```
docker ps --quiet --all | xargs docker inspect --format '{{ .Id }}: UTSMode={{ .HostConfig.UTSMode }}'
```

If the above command returns `host`, it means that the host UTS namespace is shared with the container and this recommendation is non-compliant. If the above command returns nothing, then the host's UTS namespace is not shared. This recommendation is then compliant.

## Remediation

You should not start a container with the `--uts=host` argument. For example, do not start a container using the command below:

```
docker run --rm --interactive --tty --uts=host rhel7.2
```

## Default Value

By default, all containers have the UTS namespace enabled and the host UTS namespace is not shared with any containers.

## References

1. https://docs.docker.com/engine/reference/run/#uts-settings---uts
2. https://www.man7.org/linux/man-pages/man7/uts_namespaces.7.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 13.4 Perform Traffic Filtering Between Network Segments<br>Perform traffic filtering between network segments, where appropriate. | | ● | ● |
| v7 | 14.1 Segment the Network Based on Sensitivity<br>Segment the network based on the label or classification level of the information stored on the servers, locate all sensitive information on separated Virtual Local Area Networks (VLANs). | | ● | ● |
