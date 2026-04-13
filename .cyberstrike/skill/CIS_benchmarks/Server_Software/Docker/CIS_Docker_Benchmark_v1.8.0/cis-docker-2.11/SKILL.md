---
name: cis-docker-2.11
description: "Ensure the default cgroup usage has been confirmed"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, daemon-configuration, cgroup]
cis_id: "2.11"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the default cgroup usage has been confirmed (Manual)

## Profile Applicability

• Level 2 - Docker - Linux

## Description

The `--cgroup-parent` option allows you to set the default cgroup parent to use for all containers. If there is no specific usage requirement for this, the setting should be left at its default.

## Rationale

System administrators typically define cgroups under which containers are supposed to run. Even if cgroups are not explicitly defined by the system administrators, containers run under docker cgroup by default.

It is possible to attach to a different cgroup other than the one which is the default, however this type of usage should be monitored and confirmed because attaching to a different cgroup other than that is a default, it could be possible to share resources unevenly causing resource utilization problems on the host.

## Impact

None.

## Audit Procedure

In order to confirm this setting, the dockerd start-up options and any settings in `/etc/docker/daemon.json` should be reviewed.

To review the dockerd startup options, use:

```bash
grep "--cgroup-parent" /etc/docker/daemon.json
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

**Controls Version:** v8

**Control:** 6 Access Control Management

Use processes and tools to create, assign, manage, and revoke access credentials and privileges for user, administrator, and service accounts for enterprise assets and software.

**IG 1:**
**IG 2:**
**IG 3:**

---

**Controls Version:** v7

**Control:** 18 Application Software Security

Application Software Security
