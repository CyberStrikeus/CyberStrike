---
name: cis-docker-v170-5.4
description: "Ensure that Linux kernel capabilities are restricted within containers"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, runtime, configuration, capabilities]
cis_id: "5.4"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: [CWE-250]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 5.4

## Profile Applicability
- Level 1 - Docker - Linux

## Description
By default, Docker starts containers with a restricted set of Linux kernel capabilities. This means that any process can be granted the required capabilities instead of giving it root access. Using Linux kernel capabilities, processes in general do not need to run as the root user.

## Rationale
Docker supports the addition and removal of capabilities. You should remove all capabilities not required for the correct function of the container.

Specifically, in the default capability set provided by Docker, the `NET_RAW` capability should be removed if not explicitly required, as it can give an attacker with access to a container the ability to create spoofed network traffic.

## Impact
Restrictions on processes within a container are based on which Linux capabilities are in force.

## Audit Procedure

You should run the following command:

```bash
docker ps --quiet --all | xargs docker inspect --format='{{ .Id }}: CapAdd={{ .HostConfig.CapAdd }} CapDrop={{ .HostConfig.CapDrop }}'
```

Verify that the added and deleted Linux kernel capabilities are in line with the ones needed by the container process in each container instance. Specifically, ensure that the `NET_RAW` capability is removed if not required.

## Remediation

You should execute the command below to add required capabilities:

```bash
docker run --cap-add={"Capability 1","Capability 2"} <Run arguments> <Container Image Name or ID> <Command>
```

You should execute the command below to remove unneeded capabilities:

```bash
docker run --cap-drop={"Capability 1","Capability 2"} <Run arguments> <Container Image Name or ID> <Command>
```

Alternatively, you could remove all the currently configured capabilities and then restore only the ones you specifically use:

```bash
docker run --cap-drop=all --cap-add={"Capability 1","Capability 2"} <Run arguments> <Container Image Name or ID> <Command>
```

Note that some settings can also be configured using the `--sysctl` option, reducing the need for container capabilities even further. This includes unprivileged ICMP echo sockets without `NET_RAW` and allowing opening any port less than 1024 without `NET_BIND_SERVICE`.

Adding and removing capabilities are also possible when the `docker service` command is used:

```bash
docker service create --cap-drop=all --cap-add={"Capability 1","Capability 2"} <Run arguments> <Container Image Name or ID> <Command>
```

## Default Value
By default, the capabilities below are applied to containers:

```
AUDIT_WRITE
CHOWN
DAC_OVERRIDE
FOWNER
FSETID
KILL
MKNOD
NET_BIND_SERVICE
NET_RAW
SETFCAP
SETGID
SETPCAP
SETUID
SYS_CHROOT
```

## References
1. https://docs.docker.com/engine/security/#linux-kernel-capabilities
2. https://docs.docker.com/compose/compose-file/compose-file-v3/#cap_add-cap_drop
3. https://docs.docker.com/engine/reference/commandline/service_create/#options
4. https://docs.docker.com/engine/reference/commandline/run/#configure-namespaced-kernel-parameters-sysctls-at-runtime

## CIS Controls

**v8:**
- 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure - Use standard, industry-recommended hardening configuration templates for application infrastructure components. This includes underlying servers, databases, and web servers, and applies to cloud containers, Platform as a Service (PaaS) components, and SaaS components. Do not allow in-house developed software to weaken configuration hardening.

**v7:**
- 5.2 Maintain Secure Images - Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates.

## Assessment Status
Manual
