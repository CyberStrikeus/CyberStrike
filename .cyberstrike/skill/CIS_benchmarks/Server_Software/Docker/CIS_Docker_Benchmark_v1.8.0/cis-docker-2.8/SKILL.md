---
name: cis-docker-2.8
description: "Ensure TLS authentication for Docker daemon is configured"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, daemon-configuration, tls, encryption, authentication]
cis_id: "2.8"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure TLS authentication for Docker daemon is configured (Manual)

## Profile Applicability

• Level 1 - Docker - Linux

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
grep "--tls" /etc/docker/daemon.json
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

**Controls Version:** v8

**Control:** 13.5 Manage Access Control for Remote Assets

Manage access control for assets remotely connecting to enterprise resources. Determine amount of access to enterprise resources based on: up-to-date anti-malware software installed, configuration compliance with the enterprise's secure configuration process, and ensuring the operating system and applications are up-to-date.

**IG 1:**
**IG 2:** ●
**IG 3:** ●

---

**Controls Version:** v7

**Control:** 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

**IG 1:**
**IG 2:** ●
**IG 3:** ●
