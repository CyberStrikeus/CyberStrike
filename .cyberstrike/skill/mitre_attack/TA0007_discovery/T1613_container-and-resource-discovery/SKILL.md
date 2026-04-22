---
name: "T1613_container-and-resource-discovery"
description: "Adversaries may attempt to discover containers and other resources that are available within a containers environment."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1613
  - discovery
  - containers
technique_id: "T1613"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Containers
mitre_url: "https://attack.mitre.org/techniques/T1613"
tech_stack:
  - containers
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1613 Container and Resource Discovery

## High-Level Description

Adversaries may attempt to discover containers and other resources that are available within a containers environment. Other resources may include images, deployments, pods, nodes, and other information such as the status of a cluster.

These resources can be viewed within web applications such as the Kubernetes dashboard or can be queried via the Docker and Kubernetes APIs. In Docker, logs may leak information about the environment, such as the environment’s configuration, which services are available, and what cloud provider the victim may be utilizing. The discovery of these resources may inform an adversary’s next steps in the environment, such as how to perform lateral movement and which methods to utilize for execution.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Containers

## What to Check

- [ ] Identify if Container and Resource Discovery technique is applicable to target environment
- [ ] Check Containers systems for indicators of Container and Resource Discovery
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Docker Container and Resource Discovery

Adversaries may attempt to discover containers and other resources that are available within a containers environment.

**Supported Platforms:** containers

```bash
docker build -t t1613 $PathtoAtomicsFolder/T1613/src/
docker run --name t1613_container --rm -d -t t1613
docker ps
docker stats --no-stream
docker inspect $(docker ps -l -q --filter ancestor=t1613)
```

**Dependencies:**

- Verify Docker is installed.
- Verify Docker service is running.

### Atomic Test 2: Podman Container and Resource Discovery

Adversaries may attempt to discover containers and other resources that are available within a containers environment.

**Supported Platforms:** containers

```bash
podman build -t t1613 $PathtoAtomicsFolder/T1613/src/
podman run --name t1613_container --rm -d -t t1613
podman ps
podman stats --no-stream
podman inspect $(podman ps -l -q --filter ancestor=t1613)
```

**Dependencies:**

- Verify Podman is installed.
- Verify Podman service is running.

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Container and Resource Discovery by examining the target platforms (Containers).

2. **Assess Existing Defenses**: Review whether mitigations for T1613 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1030 Network Segmentation

Deny direct remote access to internal systems through the use of network proxies, gateways, and firewalls.

### M1035 Limit Access to Resource Over Network

Limit communications with the container service to managed and secured channels, such as local Unix sockets or remote access via SSH. Require secure port access to communicate with the APIs over TLS by disabling unauthenticated access to the Docker API and Kubernetes API Server. In Kubernetes clusters deployed in cloud environments, use native cloud platform features to restrict the IP ranges that are permitted to access to API server. Where possible, consider enabling just-in-time (JIT) access to the Kubernetes API to place additional restrictions on access.

### M1018 User Account Management

Enforce the principle of least privilege by limiting dashboard visibility to only the required users. When using Kubernetes, avoid giving users wildcard permissions or adding users to the `system:masters` group, and use `RoleBindings` rather than `ClusterRoleBindings` to limit user privileges to specific namespaces.

## Detection

### Detection Strategy for Container and Resource Discovery

## Risk Assessment

| Finding                                               | Severity | Impact    |
| ----------------------------------------------------- | -------- | --------- |
| Container and Resource Discovery technique applicable | Medium   | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Docker API](https://docs.docker.com/engine/api/v1.41/)
- [Kubernetes API](https://kubernetes.io/docs/concepts/overview/kubernetes-api/)
- [Atomic Red Team - T1613](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1613)
- [MITRE ATT&CK - T1613](https://attack.mitre.org/techniques/T1613)
