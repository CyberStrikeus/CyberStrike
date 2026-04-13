---
name: cis-docker-2.2
description: "Ensure network traffic is restricted between containers on the default bridge"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, daemon-configuration, networking, icc]
cis_id: "2.2"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure network traffic is restricted between containers on the default bridge (Manual)

## Profile Applicability

• Level 1 - Docker - Linux

## Description

By default, all network traffic is allowed between containers on the same host on the default network bridge. If not desired, restrict all inter-container communication. Link specific containers together that require communication. Alternatively, you can create custom network and only join containers that need to communicate to that custom network.

## Rationale

By default, unrestricted network traffic is enabled between all containers on the same host on the default network bridge. Thus, each container has the potential of reading all packets across the container network on the same host. This might lead to an unintended and unwanted disclosure of information to other containers. Hence, restrict inter-container communication on the default network bridge.

## Impact

Inter-container communication would be disabled on the default network bridge. If any communication between containers on the same host is desired, then it needs to be explicitly defined using container linking or alternatively custom networks have to be defined.

## Audit Procedure

Run the below command and verify that the default network bridge has been configured to restrict inter-container communication.

```bash
docker network ls --quiet | xargs docker network inspect --format '{{ .Name }}: {{ .Options }}'
```

It should return `com.docker.network.bridge.enable_icc:false` for the default network bridge.

## Remediation

Edit the Docker daemon configuration file to ensure that icc is disabled. It should include the following setting:

```
"icc": false
```

Alternatively, run the docker daemon directly and pass `--icc=false` as an argument. For Example,

```bash
dockerd --icc=false
```

Alternatively, you can follow the Docker documentation and create a custom network and only join containers that need to communicate to that custom network. The `--icc` parameter only applies to the default docker bridge, if custom networks are used then the approach of segmenting networks should be adopted instead.

In order for this control to be fully effective, all containers connected to the `docker0` bridge should drop the `NET_RAW` capability, otherwise a compromised container could use raw ethernet packets to communicate with other containers despite this restriction.

## Default Value

By default, all inter-container communication is allowed on the default network bridge.

## References

1. https://docs.docker.com/network/
2. https://github.com/docker/cli/blob/v20.10.1/man/dockerd.8.md

## CIS Controls

**Controls Version:** v8

**Control:** 12.3 Securely Manage Network Infrastructure

Securely manage network infrastructure. Example implementations include version-controlled-infrastructure-as-code, and the use of secure network protocols, such as SSH and HTTPS.

**IG 1:**
**IG 2:** ●
**IG 3:** ●

---

**Controls Version:** v7

**Control:** 9 Limitation and Control of Network Ports, Protocols, and Services

Limitation and Control of Network Ports, Protocols, and Services
