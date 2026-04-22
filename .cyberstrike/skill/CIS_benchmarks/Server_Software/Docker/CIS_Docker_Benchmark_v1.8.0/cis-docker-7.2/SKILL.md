---
name: cis-docker-7.2
description: "Ensure that swarm services are bound to a specific host interface"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, swarm, orchestration, networking]
cis_id: "7.2"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.2 Ensure that swarm services are bound to a specific host interface (Manual)

## Profile Applicability

- Level 1 - Docker Swarm

## Description

By default, Docker swarm services will listen on all interfaces on the host. This may not be necessary for the operation of the swarm where the host has multiple network interfaces.

## Rationale

When a swarm is initialized the default value for the `--listen-addr` flag is `0.0.0.0:2377` which means that swarm services will listen on all interfaces on the host. If a host has multiple network interfaces this may be undesirable as it could expose swarm services to networks which are not involved with the operation of the swarm.

By passing a specific IP address to the `--listen-addr`, a specific network interface can be specified, limiting this exposure.

## Impact

None

## Audit Procedure

You should check the network listener on port 2377 (the default for docker swarm) and 7946 (container network discovery), and confirm that it is only listening on specific interfaces. For example, in this could be done using the following command:

```
ss -lp | grep -iE ':2377|:7946'
```

## Remediation

Resolving this issues requires re-initialization of the swarm, specifying a specific interface for the `--listen-addr` parameter.

## Default Value

By default, Docker swarm services listen on all available host interfaces.

## References

1. https://docs.docker.com/engine/reference/commandline/swarm_init/#--listen-addr
2. https://docs.docker.com/engine/swarm/admin_guide/#recover-from-disaster

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers<br>Implement and manage a firewall on servers, where supported. Example implementations include a virtual firewall, operating system firewall, or a third-party firewall agent. | ●    | ●    | ●    |
| v7               | 9 Limitation and Control of Network Ports, Protocols, and Services<br>Limitation and Control of Network Ports, Protocols, and Services                                                                                         |      |      |      |
