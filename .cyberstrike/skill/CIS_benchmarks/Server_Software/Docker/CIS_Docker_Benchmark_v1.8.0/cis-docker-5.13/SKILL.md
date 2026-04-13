---
name: cis-docker-5.13
description: "Ensure that the container's root filesystem is mounted as read only"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, runtime, filesystem, security, immutability]
cis_id: "5.13"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.13 Ensure that the container's root filesystem is mounted as read only (Manual)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

The container's root filesystem should be treated as a 'golden image' by using Docker run's `--read-only` option. This prevents any writes to the container's root filesystem at container runtime and enforces the principle of immutable infrastructure.

## Rationale

Enabling this option forces containers at runtime to explicitly define their data writing strategy to persist or not persist their data.

This also reduces security attack vectors since the container instance's filesystem cannot be tampered with or written to unless it has explicit read-write permissions on its filesystem folder and directories.

## Impact

Enabling `--read-only` at container runtime may break some container OS packages if a data writing strategy is not defined.

You should define what the container's data should and should not persist at runtime in order to decide which strategy to use.

Example:

- Enable use `--tmpfs` for temporary file writes to `/tmp`
- Use Docker shared data volumes for persistent data writes

## Audit Procedure

You should run the following command on the docker host:

```bash
docker ps --quiet --all | xargs docker inspect --format='{{ .Id }}: ReadonlyRootfs={{ .HostConfig.ReadonlyRootfs }}'
```

If the above command returns `true`, it means the container's root filesystem is mounted read-only.

If the above command returns `false`, it means the container's root filesystem is writeable.

## Remediation

You should add a `--read-only` flag at a container's runtime to enforce the container's root filesystem being mounted as read only.

```bash
docker run <Run arguments> --read-only <Container Image Name or ID> <Command>
```

Enabling the `--read-only` option at a container's runtime should be used by administrators to force a container's executable processes to only write container data to explicit storage locations during its lifetime.

Examples of explicit storage locations during a container's runtime include, but are not limited to:

1. Using the `--tmpfs` option to mount a temporary file system for non-persistent data writes to `/tmp`

```bash
docker run --interactive --tty --read-only --tmpfs "/run" --tmpfs "/tmp" centos /bin/bash
```

2. Enabling Docker rw mounts at a container's runtime to persist container data directly on the Docker host filesystem

```bash
docker run --interactive --tty --read-only -v /opt/app/data:/run/app/data:rw centos /bin/bash
```

3. Utilizing the Docker shared-storage volume plugin for Docker data volume to persist container data.

```bash
docker volume create -d convoy --opt o=size=20GB my-named-volume
docker run --interactive --tty --read-only -v my-named-volume:/run/app/data centos /bin/bash
```

3. Transmitting container data outside of the Docker controlled area during the container's runtime for container data in order to ensure that it is persistent. Examples include hosted databases, network file shares and APIs.

## Default Value

By default, a container has its root filesystem writeable, allowing all container processes to write files owned by the container's actual runtime user.

## References

1. https://docs.docker.com/storage/volumes/
2. https://docs.docker.com/storage/volumes/#use-a-read-only-volume
3. https://docs.docker.com/engine/reference/commandline/run/#mount-tmpfs---tmpfs

## CIS Controls

### v8

**6.8 Define and Maintain Role-Based Access Control**

Define and maintain role-based access control, through determining and documenting the access rights necessary for each role within the enterprise to successfully carry out its assigned duties. Perform access control reviews of enterprise assets to validate that all privileges are authorized, on a recurring schedule at a minimum annually, or more frequently.

### v7

**14.6 Protect Information through Access Control Lists**

Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.
