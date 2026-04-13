---
name: cis-docker-v170-2.7
description: "Ensure TLS authentication for Docker daemon is configured"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, configuration, tls, authentication, encryption]
cis_id: "2.7"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 2.7

## Profile Applicability
- **Level:** 1 - Docker - Linux

## Description
It is possible to make the Docker daemon available remotely over a TCP port. If this is required, you should ensure that TLS authentication is configured in order to restrict access to the Docker daemon via IP address and port.

## Rationale
By default, the Docker daemon binds to a non-networked Unix socket and runs with root privileges. If you change the default Docker daemon binding to a TCP port or any other Unix socket, anyone with access to that port or socket could have full access to the Docker daemon and therefore in turn to the host system. For this reason, you should not bind the Docker daemon to another IP/port or a Unix socket.

If you must expose the Docker daemon via a network socket, you should configure TLS authentication for the daemon and for any Docker Swarm APIs (if they are in use). This type of configuration restricts the connections to your Docker daemon over the network to a limited number of clients who have access to the TLS client credentials.

## Impact
You would need to manage and guard certificates and keys for the Docker daemon and Docker clients.

## Audit Procedure

To confirm this setting, review the dockerd start-up options and any settings in `/etc/docker/daemon.json`.

To review the dockerd startup options, use:

```bash
ps -ef | grep dockerd
```

Ensure that the below parameters are present:

```
--tlsverify
--tlscacert
--tlscert
--tlskey
```

The contents of `/etc/docker/daemon.json` to ensure these settings are in place.

## Remediation

Follow the steps mentioned in the Docker documentation or other references.

## Default Value
By default, TLS authentication is not configured.

## References
1. https://docs.docker.com/engine/security/https/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 13.5 Manage Access Control for Remote Assets<br/>Manage access control for assets remotely connecting to enterprise resources. Determine amount of access to enterprise resources based on: up-to-date anti-malware software installed, configuration compliance with the enterprise's secure configuration process, and ensuring the operating system and applications are up-to-date. | | ● | ● |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running<br/>Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system. | | ● | ● |

## Profile
**Level 1 - Docker - Linux** (Manual)
