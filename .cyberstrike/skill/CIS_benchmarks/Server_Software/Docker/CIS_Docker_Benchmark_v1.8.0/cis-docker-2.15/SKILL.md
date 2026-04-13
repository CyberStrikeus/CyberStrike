---
name: cis-docker-2.15
description: "Ensure containers are restricted from acquiring new privileges"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, daemon-configuration, privileges, no-new-privileges]
cis_id: "2.15"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure containers are restricted from acquiring new privileges (Manual)

## Profile Applicability

• Level 1 - Docker - Linux

## Description

By default you should restrict containers from acquiring additional privileges via suid or sgid.

## Rationale

A process can set the `no_new_priv` bit in the kernel and this persists across forks, clones and execve. The `no_new_priv` bit ensures that the process and its child processes do not gain any additional privileges via suid or sgid bits. This reduces the security risks associated with many dangerous operations because there is a much reduced ability to subvert privileged binaries.

Setting this at the daemon level ensures that by default all new containers are restricted from acquiring new privileges.

## Impact

`no_new_priv` prevents LSMs such as SELinux from escalating the privileges of individual containers.

## Audit Procedure

To confirm this setting, you should review the dockerd start-up options and a check of any settings in `/etc/docker/daemon.json` should also be carried out.

To review the dockerd startup options, the following command can be used:

```bash
ps -ef | grep dockerd
```

You should ensure that the `--no-new-privileges` parameter is present and that it is not set to `false`.

The contents of `/etc/docker/daemon.json` should also be reviewed.

## Remediation

You should run the Docker daemon as below:

```bash
dockerd --no-new-privileges
```

## Default Value

By default, containers are not restricted from acquiring new privileges.

## References

1. https://docs.docker.com/engine/reference/commandline/dockerd/
2. https://github.com/moby/moby/pull/20727

## CIS Controls

**Controls Version:** v8

**Control:** 6.1 Establish an Access Granting Process

Establish and follow a process, preferably automated, for granting access to enterprise assets upon new hire, rights grant, or role change of a user.

**IG 1:** ●
**IG 2:** ●
**IG 3:** ●

---

**Controls Version:** v7

**Control:** 4 Controlled Use of Administrative Privileges

Controlled Use of Administrative Privileges
