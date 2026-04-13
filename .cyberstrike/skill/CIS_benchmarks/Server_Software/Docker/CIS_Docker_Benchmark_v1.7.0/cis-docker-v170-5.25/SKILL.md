---
name: cis-docker-v170-5.25
description: "Ensure that cgroup usage is confirmed"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, runtime, cgroup, configuration]
cis_id: "5.25"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 5.25

## Profile Applicability
- **Level:** 1
- **Type:** Manual
- **Platform:** Docker - Linux

## Description

It is possible to attach to a particular cgroup when a container is instantiated. Confirming cgroup usage would ensure that containers are running in defined cgroups.

## Rationale

System administrators typically define groups in which containers are supposed to run. If cgroups are not explicitly defined by the system administrator, containers run in the `docker` cgroup by default.

At run time, it is possible to attach a container to a different cgroup other than the one originally defined. This usage should be monitored and confirmed, as by attaching to a different cgroup, excess permissions and resources might be granted to the container and this can therefore prove to be a security risk.

## Impact

None.

## Audit Procedure

You should run the following command:

```bash
docker ps --quiet --all | xargs docker inspect --format '{{ .Id }}: CgroupParent={{ .HostConfig.CgroupParent }}'
```

The above command returns the cgroup where the containers are running. If it is blank, it means that containers are running under the default `docker` cgroup. Any other return value indicates that the system is not configured in line with good security practice.

## Remediation

You should not use the `--cgroup-parent` option within the `docker run` command unless strictly required.

## Default Value

By default, containers run under `docker` cgroup.

## References

1. https://docs.docker.com/engine/reference/run/#specify-custom-cgroups

## CIS Controls

**v8:**
- **3.3 Configure Data Access Control Lists**
  - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.

**v7:**
- **14.6 Protect Information through Access Control Lists**
  - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.
