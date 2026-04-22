---
name: "T1552.007_container-api"
description: "Adversaries may gather credentials via APIs within a containers environment."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1552.007
  - credential-access
  - containers
  - sub-technique
technique_id: "T1552.007"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Containers
mitre_url: "https://attack.mitre.org/techniques/T1552/007"
tech_stack:
  - containers
cwe_ids:
  - CWE-522
chains_with:
  - T1552
  - T1552.001
  - T1552.002
  - T1552.003
  - T1552.004
  - T1552.005
  - T1552.006
  - T1552.008
prerequisites:
  - T1552
severity_boost:
  T1552: "Chain with T1552 for deeper attack path"
  T1552.001: "Chain with T1552.001 for deeper attack path"
  T1552.002: "Chain with T1552.002 for deeper attack path"
---

# T1552.007 Container API

> **Sub-technique of:** T1552

## High-Level Description

Adversaries may gather credentials via APIs within a containers environment. APIs in these environments, such as the Docker API and Kubernetes APIs, allow a user to remotely manage their container resources and cluster components.

An adversary may access the Docker API to collect logs that contain credentials to cloud, container, and various other resources in the environment. An adversary with sufficient permissions, such as via a pod's service account, may also use the Kubernetes API to retrieve credentials from the Kubernetes API server. These credentials may include those needed for Docker API authentication or secrets from Kubernetes cluster components.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Containers

## What to Check

- [ ] Identify if Container API technique is applicable to target environment
- [ ] Check Containers systems for indicators of Container API
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: List All Secrets

A Kubernetes secret is an object that lets users store and manage sensitive information, such as passwords and connection strings in the cluster. Secrets can be consumed by reference in the pod configuration. Attackers who have permissions to retrieve the secrets from the API server (by using the pod service account, for example) can access sensitive information that might include credentials to various services or provide further access to the cluster.
[More information about secrets](https://kubernetes.io/docs/concepts/configuration/secret/).

This test will make a request to the Kubernetes api at the `/api/v1/secrets` endpoint requesting every secret stored within the cluster.

**Supported Platforms:** containers

```bash
kubectl get secrets --all-namespaces
```

**Dependencies:**

- kubectl must be installed

### Atomic Test 2: ListSecrets

A Kubernetes secret is an object that lets users store and manage sensitive information, such as passwords and connection strings in the cluster. Secrets can be consumed by reference in the pod configuration. Attackers who have permissions to retrieve the secrets from the API server (by using the pod service account, for example) can access sensitive information that might include credentials to various services.

**Supported Platforms:** containers

```bash
kubectl get secrets -n #{namespace}
```

**Dependencies:**

- kubectl must be installed

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Container API by examining the target platforms (Containers).

2. **Assess Existing Defenses**: Review whether mitigations for T1552.007 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management

Use the principle of least privilege for privileged accounts such as the service account in Kubernetes. For example, if a pod is not required to access the Kubernetes API, consider disabling the service account altogether.

### M1035 Limit Access to Resource Over Network

Limit communications with the container service to managed and secured channels, such as local Unix sockets or remote access via SSH. Require secure port access to communicate with the APIs over TLS by disabling unauthenticated access to the Docker API and Kubernetes API Server. In Kubernetes clusters deployed in cloud environments, use native cloud platform features to restrict the IP ranges that are permitted to access to API server. Where possible, consider enabling just-in-time (JIT) access to the Kubernetes API to place additional restrictions on access.

### M1030 Network Segmentation

Deny direct remote access to internal systems through the use of network proxies, gateways, and firewalls.

### M1018 User Account Management

Enforce authentication and role-based access control on the container API to restrict users to the least privileges required. When using Kubernetes, avoid giving users wildcard permissions or adding users to the `system:masters` group, and use `RoleBindings` rather than `ClusterRoleBindings` to limit user privileges to specific namespaces.

## Detection

### Detect Abuse of Container APIs for Credential Access

## Risk Assessment

| Finding                            | Severity | Impact            |
| ---------------------------------- | -------- | ----------------- |
| Container API technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Unit 42 Unsecured Docker Daemons](https://unit42.paloaltonetworks.com/attackers-tactics-and-techniques-in-unsecured-docker-daemons-revealed/)
- [Docker API](https://docs.docker.com/engine/api/v1.41/)
- [Kubernetes API](https://kubernetes.io/docs/concepts/overview/kubernetes-api/)
- [Atomic Red Team - T1552.007](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1552.007)
- [MITRE ATT&CK - T1552.007](https://attack.mitre.org/techniques/T1552/007)
