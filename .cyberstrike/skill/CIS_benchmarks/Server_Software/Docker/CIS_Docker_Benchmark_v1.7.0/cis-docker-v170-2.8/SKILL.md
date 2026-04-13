---
name: cis-docker-v170-2.8
description: "Ensure the default ulimit is configured appropriately"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, configuration, ulimit, resources]
cis_id: "2.8"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 2.8

## Profile Applicability
- **Level:** 1 - Docker - Linux

## Description
Set the default ulimit options as appropriate in your environment.

## Rationale
`ulimit` provides control over the resources available to the shell and to processes which it starts. Setting system resource limits judiciously can save you from disasters such as a fork bomb. On occasion, even friendly users and legitimate processes can overuse system resources and can make the system unusable.

Setting the default ulimit for the Docker daemon enforces the ulimit for all container instances. In this case you would not need to setup ulimit for each container instance. However, the default ulimit can be overridden during container runtime, if needed. Therefore, in order to have proper control over system resources, define a default ulimit as is needed in your environment.

## Impact
If ulimits are set incorrectly this could cause issues with system resources, possibly causing a denial of service condition.

## Audit Procedure

To confirm this setting you should review the dockerd start-up options and any settings in `/etc/docker/daemon.json`.

To review the dockerd startup options, use:

```bash
ps -ef | grep dockerd
```

Ensure that the `--default-ulimit` parameter is set as appropriate.

The contents of `/etc/docker/daemon.json` should also be reviewed for this setting.

## Remediation

Run Docker in daemon mode and pass `--default-ulimit` as argument with respective ulimits as appropriate in your environment and in line with your security policy.

For Example,

```bash
dockerd --default-ulimit nproc=1024:2048 --default-ulimit nofile=100:200
```

## Default Value
By default, no ulimit is set.

## References
1. https://docs.docker.com/engine/reference/commandline/dockerd/#default-ulimit-settings

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure<br/>Use standard, industry-recommended hardening configuration templates for application infrastructure components. This includes underlying servers, databases, and web servers, and applies to cloud containers, Platform as a Service (PaaS) components, and SaaS components. Do not allow in-house developed software to weaken configuration hardening. | | ● | ● |
| v7 | 18 Application Software Security<br/>Application Software Security | | | |

## Profile
**Level 1 - Docker - Linux** (Manual)
