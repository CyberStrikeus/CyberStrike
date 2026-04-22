---
name: cis-docker-5.20
description: "Ensure mount propagation mode is not set to shared"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, runtime, namespaces, volumes]
cis_id: "5.20"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.20 Ensure mount propagation mode is not set to shared (Manual)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

Mount propagation mode allows mounting volumes in shared, slave or private mode on a container. Do not use shared mount propagation mode unless explicitly needed.

## Rationale

A shared mount is replicated at all mounts and changes made at any mount point are propagated to all other mount points.

Mounting a volume in shared mode does not restrict any other container from mounting and making changes to that volume.

As this is likely not a desirable option from a security standpoint, this feature should not be used unless explicitly required.

## Impact

None.

## Audit Procedure

```
docker ps --quiet --all | xargs docker inspect --format '{{ .Id }}: Propagation={{range $mnt := .Mounts}}{{json $mnt.Propagation}}{{end}}'
```

The above command returns the propagation mode for mounted volumes. The propagation mode should not be set to `shared` unless needed. The above command might throw errors if there are no mounts. In that case, this recommendation is not applicable.

## Remediation

Do not mount volumes in shared mode propagation.
For example, do not start a container as below:

```
docker run <Run arguments> --volume=/hostPath:/containerPath:shared <Container Image Name or ID> <Command>
```

## Default Value

By default, the container mounts are private.

## References

1. https://docs.docker.com/storage/bind-mounts/#configure-bind-propagation
2. https://docs.docker.com/engine/reference/run/#volume-shared-filesystems

## CIS Controls

| Controls Version | Control                                                                                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3 Data Protection<br>Develop processes and technical controls to identify, classify, securely handle, retain, and dispose of data. |      |      |      |
| v7               | 13 Data Protection<br>Data Protection                                                                                              |      |      |      |
