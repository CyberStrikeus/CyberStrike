---
name: "T1610_deploy-container"
description: "Adversaries may deploy a container into an environment to facilitate execution or evade defenses."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1610
  - defense-evasion
  - execution
  - containers
technique_id: "T1610"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - execution
platforms:
  - Containers
mitre_url: "https://attack.mitre.org/techniques/T1610"
tech_stack:
  - containers
cwe_ids:
  - CWE-693
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1610 Deploy Container

## High-Level Description

Adversaries may deploy a container into an environment to facilitate execution or evade defenses. In some cases, adversaries may deploy a new container to execute processes associated with a particular image or deployment, such as processes that execute or download malware. In others, an adversary may deploy a new container configured without network rules, user limitations, etc. to bypass existing defenses within the environment. In Kubernetes environments, an adversary may attempt to deploy a privileged or vulnerable container into a specific node in order to Escape to Host and access other containers running on the node. 

Containers can be deployed by various means, such as via Docker's <code>create</code> and <code>start</code> APIs or via a web application such as the Kubernetes dashboard or Kubeflow. In Kubernetes environments, containers may be deployed through workloads such as ReplicaSets or DaemonSets, which can allow containers to be deployed across multiple nodes. Adversaries may deploy containers based on retrieved or built malicious images or from benign images that download and execute malicious payloads at runtime.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Execution (TA0002)

**Platforms:** Containers

## What to Check

- [ ] Identify if Deploy Container technique is applicable to target environment
- [ ] Check Containers systems for indicators of Deploy Container
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Deploy Docker container

Adversaries may deploy containers based on retrieved or built malicious images or from benign images that download and execute malicious payloads at runtime. They can do this using docker create and docker start commands. Kinsing & Doki was exploited using this technique.

**Supported Platforms:** containers

```bash
docker build -t t1610 $PathtoAtomicsFolder/T1610/src/
docker run --name t1610_container --rm -itd t1610 bash /tmp/script.sh
```

**Dependencies:**
- Verify docker is installed.
- Verify docker service is running.


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Deploy Container by examining the target platforms (Containers).

2. **Assess Existing Defenses**: Review whether mitigations for T1610 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1018 User Account Management
Enforce the principle of least privilege by limiting container dashboard access to only the necessary users. When using Kubernetes, avoid giving users wildcard permissions or adding users to the `system:masters` group, and use `RoleBindings` rather than `ClusterRoleBindings` to limit user privileges to specific namespaces.

### M1047 Audit
Scan images before deployment, and block those that are not in compliance with security policies. In Kubernetes environments, the admission controller can be used to validate images after a container deployment request is authenticated but before the container is deployed.

### M1030 Network Segmentation
Deny direct remote access to internal systems through the use of network proxies, gateways, and firewalls.

### M1035 Limit Access to Resource Over Network
Limit communications with the container service to managed and secured channels, such as local Unix sockets or remote access via SSH. Require secure port access to communicate with the APIs over TLS by disabling unauthenticated access to the Docker API, Kubernetes API Server, and container orchestration web applications. In Kubernetes clusters deployed in cloud environments, use native cloud platform features to restrict the IP ranges that are permitted to access to API server. Where possible, consider enabling just-in-time (JIT) access to the Kubernetes API to place additional restrictions on access.


## Detection

### Behavior-chain detection for T1610 Deploy Container across Docker & Kubernetes control/node planes


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Deploy Container technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [AppSecco Kubernetes Namespace Breakout 2020](https://blog.appsecco.com/kubernetes-namespace-breakout-using-insecure-host-path-volume-part-1-b382f2a6e216)
- [Aqua Build Images on Hosts](https://blog.aquasec.com/malicious-container-image-docker-container-host)
- [Docker Containers API](https://docs.docker.com/engine/api/v1.41/#tag/Container)
- [Kubernetes Workload Management](https://kubernetes.io/docs/concepts/workloads/controllers/)
- [Kubeflow Pipelines](https://www.kubeflow.org/docs/components/pipelines/overview/pipelines-overview/)
- [Kubernetes Dashboard](https://kubernetes.io/docs/tasks/access-application-cluster/web-ui-dashboard/)
- [Atomic Red Team - T1610](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1610)
- [MITRE ATT&CK - T1610](https://attack.mitre.org/techniques/T1610)
