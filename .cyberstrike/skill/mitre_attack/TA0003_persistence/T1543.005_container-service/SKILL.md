---
name: "T1543.005_container-service"
description: "Adversaries may create or modify container or container cluster management tools that run as daemons, agents, or services on individual hosts."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1543.005
  - persistence
  - privilege-escalation
  - containers
  - sub-technique
technique_id: "T1543.005"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Containers
mitre_url: "https://attack.mitre.org/techniques/T1543/005"
tech_stack:
  - containers
cwe_ids:
  - CWE-276
chains_with:
  - T1543
  - T1543.001
  - T1543.002
  - T1543.003
  - T1543.004
prerequisites:
  - T1543
severity_boost:
  T1543: "Chain with T1543 for deeper attack path"
  T1543.001: "Chain with T1543.001 for deeper attack path"
  T1543.002: "Chain with T1543.002 for deeper attack path"
---

# T1543.005 Container Service

> **Sub-technique of:** T1543

## High-Level Description

Adversaries may create or modify container or container cluster management tools that run as daemons, agents, or services on individual hosts. These include software for creating and managing individual containers, such as Docker and Podman, as well as container cluster node-level agents such as kubelet. By modifying these services, an adversary may be able to achieve persistence or escalate their privileges on a host.

For example, by using the `docker run` or `podman run` command with the `restart=always` directive, a container can be configured to persistently restart on the host. A user with access to the (rootful) docker command may also be able to escalate their privileges on the host.

In Kubernetes environments, DaemonSets allow an adversary to persistently Deploy Containers on all nodes, including ones added later to the cluster. Pods can also be deployed to specific nodes using the `nodeSelector` or `nodeName` fields in the pod spec.

Note that containers can also be configured to run as Systemd Services.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Containers

## What to Check

- [ ] Identify if Container Service technique is applicable to target environment
- [ ] Check Containers systems for indicators of Container Service
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Container Service by examining the target platforms (Containers).

2. **Assess Existing Defenses**: Review whether mitigations for T1543.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1054 Software Configuration

Where possible, consider enforcing the use of container services in rootless mode to limit the possibility of privilege escalation or malicious effects on the host running the container.

### M1018 User Account Management

Limit access to utilities such as docker to only users who have a legitimate need, especially if using docker in rootful mode. In Kubernetes environments, only grant privileges to deploy pods to users that require it.

## Detection

### Detect persistent or elevated container services via container runtime or cluster manipulation

## Risk Assessment

| Finding                                | Severity | Impact      |
| -------------------------------------- | -------- | ----------- |
| Container Service technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [AppSecco Kubernetes Namespace Breakout 2020](https://blog.appsecco.com/kubernetes-namespace-breakout-using-insecure-host-path-volume-part-1-b382f2a6e216)
- [Docker Systemd](https://docs.docker.com/config/containers/start-containers-automatically/)
- [GTFOBins Docker](https://gtfobins.github.io/gtfobins/docker/)
- [Kubernetes Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/)
- [Kubernetes DaemonSet](https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/)
- [Aquasec Kubernetes Attack 2023](https://blog.aquasec.com/leveraging-kubernetes-rbac-to-backdoor-clusters)
- [AquaSec TeamTNT 2023](https://blog.aquasec.com/teamtnt-reemerged-with-new-aggressive-cloud-campaign)
- [Podman Systemd](https://www.redhat.com/sysadmin/podman-run-pods-systemd-services)
- [Atomic Red Team - T1543.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1543.005)
- [MITRE ATT&CK - T1543.005](https://attack.mitre.org/techniques/T1543/005)
