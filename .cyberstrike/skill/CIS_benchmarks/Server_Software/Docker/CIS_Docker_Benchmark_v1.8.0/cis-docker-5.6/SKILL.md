---
name: cis-docker-5.6
description: "Ensure sensitive host system directories are not mounted on containers"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, runtime, volumes, mounts, security]
cis_id: "5.6"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.6 Ensure sensitive host system directories are not mounted on containers (Manual)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

You should not allow sensitive host system directories such as those listed below to be mounted as container volumes, especially in read-write mode.

```
/
/boot
/dev
/etc
/lib
/lib64
/proc
/sys
/usr
```

## Rationale

If sensitive directories are mounted in read-write mode, it could be possible to make changes to files within them. This has obvious security implications and should be avoided.

## Impact

None.

## Audit Procedure

You should run the following command:

```bash
docker ps --quiet --all | xargs docker inspect --format='{{ .Id }}: Volumes={{ .Mounts }}'
```

This command returns a list of currently mapped directories and indicates whether they are mounted in read-write mode for each container instance.

## Remediation

You should not mount directories which are security sensitive on the host within containers, especially in read-write mode.

## Default Value

Docker defaults to using a read-write volume but you can also mount a directory read-only. By default, no sensitive host directories are mounted within containers.

## References

1. https://docs.docker.com/storage/volumes/

## CIS Controls

### v8

**3 Data Protection**

Develop processes and technical controls to identify, classify, securely handle, retain, and dispose of data.

### v7

**13 Data Protection**

Data Protection
