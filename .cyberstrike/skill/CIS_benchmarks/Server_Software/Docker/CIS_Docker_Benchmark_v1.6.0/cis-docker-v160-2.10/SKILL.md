---
name: cis-docker-v160-2.10
description: "Ensure the default cgroup usage has been confirmed"
category: cis-docker
version: "1.6.0"
author: cyberstrike-official
tags: [cis, docker, daemon, cgroup, resource-management]
cis_id: "2.10"
cis_benchmark: "CIS Docker Benchmark v1.6.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the default cgroup usage has been confirmed

**Profile Applicability:** Level 2 - Docker - Linux

**Assessment Status:** Manual

## Description

The `--cgroup-parent` option allows you to set the default cgroup parent to use for all containers. If there is no specific usage requirement for this, the setting should be left at its default.

## Rationale

System administrators typically define cgroups under which containers are supposed to run. Even if cgroups are not explicitly defined by the system administrators, containers run under docker cgroup by default.

It is possible to attach to a different cgroup other than the one which is the default, however this type of usage should be monitored and confirmed because attaching to a different cgroup other than the one that is a default, it could be possible to share resources unevenly causing resource utilization problems on the host.

## Impact

None.

## Audit Procedure

In order to confirm this setting, the dockerd start-up options and any settings in `/etc/docker/daemon.json` should be reviewed.
To review the dockerd startup options, use:

```bash
ps -ef | grep dockerd
```

You should ensure that the `--cgroup-parent` parameter is either not set or is set as appropriate non-default cgroup.
The contents of `/etc/docker/daemon.json` should also be checked for this setting.

## Remediation

The default setting is in line with good security practice and can be left in situ. If you wish to specifically set a non-default cgroup, pass the `--cgroup-parent` parameter to the Docker daemon when starting it.
For example,

```bash
dockerd --cgroup-parent=/foobar
```

## Default Value

By default, docker daemon uses `/docker` for fs cgroup driver and `system.slice` for systemd cgroup driver.

## References

1. https://docs.docker.com/engine/reference/commandline/dockerd/#default-cgroup-parent

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6 Access Control Management<br>Use processes and tools to create, assign, manage, and revoke access credentials and privileges for user, administrator, and service accounts for enterprise assets and software. | | | |
| v7 | 18 Application Software Security<br>Application Software Security | | | |

## Profile/Assessment Status

**Profile:** Level 2 - Docker - Linux
**Assessment Status:** Manual
