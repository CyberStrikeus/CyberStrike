---
name: cis-docker-v170-1.1.2
description: "Ensure only trusted users are allowed to control Docker daemon"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, host-configuration, access-control, user-management]
cis_id: "1.1.2"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 1.1.2

## Profile
- **Level:** 1 - Docker - Linux
- **Assessment Status:** Manual

## Description

The Docker daemon currently requires access to the Docker socket which is, by default, owned by the user `root` and the group `docker`.

## Rationale

Docker allows you to share a directory between the Docker host and a guest container without limiting the access rights of the container. This means that you can start a container and map the `/` directory on your host to the container. The container would then be able to modify your host file system without any restrictions. This means that you could gain elevated privileges simply by being a member of the `docker` group and subsequently start a container which maps the root `/` directory on the host.

## Impact

Provided the proceeding instructions are implemented, rights to build and execute containers as normal user would be restricted.

## Audit Procedure

Execute the following command on the docker host and ensure that only trusted users are members of the `docker` group.

```bash
getent group docker
```

## Remediation

You should remove any untrusted users from the `docker` group. Additionally, you should not create a mapping of sensitive directories from the host to container volumes.

## Default Value

Not Applicable

## References

1. https://docs.docker.com/engine/security/#docker-daemon-attack-surface
2. http://www.projectatomic.io/blog/2015/08/why-we-dont-let-non-root-users-run-docker-in-centos-fedora-or-rhel/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.1 Establish an Access Granting Process<br/>Establish and follow a process, preferably automated, for granting access to enterprise assets upon new hire, rights grant, or role change of a user. | ● | ● | ● |
| v7 | 4 Controlled Use of Administrative Privileges<br/>Controlled Use of Administrative Privileges | | | |
