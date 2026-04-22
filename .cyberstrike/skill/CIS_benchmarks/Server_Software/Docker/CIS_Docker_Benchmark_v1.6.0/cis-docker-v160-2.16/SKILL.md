---
name: cis-docker-v160-2.16
description: "Ensure Userland Proxy is Disabled"
category: cis-docker
version: "1.6.0"
author: cyberstrike-official
tags: [cis, docker, daemon, userland-proxy, networking]
cis_id: "2.16"
cis_benchmark: "CIS Docker Benchmark v1.6.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Userland Proxy is Disabled

**Profile Applicability:** Level 1 - Docker - Linux

**Assessment Status:** Manual

## Description

The Docker daemon starts a userland proxy service for port forwarding whenever a port is exposed. Where hairpin NAT is available, this service is generally superfluous to requirements and can be disabled.

## Rationale

The Docker engine provides two mechanisms for forwarding ports from the host to containers, hairpin NAT, and the use of a userland proxy. In most circumstances, the hairpin NAT mode is preferred as it improves performance and makes use of native Linux iptables functionality instead of using an additional component.

Where hairpin NAT is available, the userland proxy should be disabled on startup to reduce the attack surface of the installation.

## Impact

Some systems with older Linux kernels may not be able to support hairpin NAT and therefore require the userland proxy service. Also, some networking setups can be impacted by the removal of the userland proxy.

## Audit Procedure

To confirm this setting, you should review the dockerd start-up options and any settings in `/etc/docker/daemon.json`.
To review the dockerd startup options, use:

```bash
ps -ef | grep dockerd
```

Ensure that the `--userland-proxy` parameter is set to `false`.
The contents of `/etc/docker/daemon.json` should also be reviewed for this setting.

## Remediation

You should run the Docker daemon as below:

```bash
dockerd --userland-proxy=false
```

## Default Value

By default, the userland proxy is enabled.

## References

1. http://windsock.io/the-docker-proxy/
2. https://github.com/docker/docker/issues/14856
3. https://github.com/docker/docker/issues/22741
4. https://docs.docker.com/config/containers/container-networking/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software<br>Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function. |      | ●    | ●    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running<br>Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.                                       |      | ●    | ●    |

## Profile/Assessment Status

**Profile:** Level 1 - Docker - Linux
**Assessment Status:** Manual
