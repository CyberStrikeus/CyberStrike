---
name: "T1059.013_container-cliapi"
description: "Adversaries may abuse built-in CLI tools or API calls to execute malicious commands in containerized environments."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1059.013
  - execution
  - containers
  - sub-technique
technique_id: "T1059.013"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Containers
mitre_url: "https://attack.mitre.org/techniques/T1059/013"
tech_stack:
  - containers
cwe_ids:
  - CWE-94
chains_with:
  - T1059
  - T1059.001
  - T1059.002
  - T1059.003
  - T1059.004
  - T1059.005
  - T1059.006
  - T1059.007
  - T1059.008
  - T1059.009
  - T1059.010
  - T1059.011
  - T1059.012
prerequisites:
  - T1059
severity_boost:
  T1059: "Chain with T1059 for deeper attack path"
  T1059.001: "Chain with T1059.001 for deeper attack path"
  T1059.002: "Chain with T1059.002 for deeper attack path"
---

# T1059.013 Container CLI/API

> **Sub-technique of:** T1059

## High-Level Description

Adversaries may abuse built-in CLI tools or API calls to execute malicious commands in containerized environments.

The Docker CLI is used for managing containers via an exposed API point from the `dockerd` daemon. Some common examples of Docker CLI include Docker Desktop CLI and Docker Compose, but users are also able to use SDKs to interact with the API. For example, Docker SDK for Python can be used to run commands within a Python application.

Adversaries may leverage the Docker CLI, API, or SDK to pull or build Docker images (i.e., Ingress Tool Transfer, Build Image on Host), run containers (i.e., Deploy Container), or execute commands inside running containers (i.e., Container Administration Command). In some cases, threat actors may pull legitimate images that include scripts or tools that they can leverage - for example, using an image that includes the `curl` command to download payloads. Adversaries may also utilize `docker inspect` and `docker ps` to scan for cloud environment variables and other running containers (i.e., Container and Resource Discovery).

Kubernetes is responsible for the management and orchestration of containers across clusters. The Kubernetes control plane, which manages the state of the cluster and is responsible for scheduling, communication, and resource monitoring, can be invoked directly via the API or indirectly via CLI tools such as `kubectl`. It may also be accessed within client libraries such as Go or Python. By utilizing the API, administrators can interact with resources within the cluster such as listing or creating pods, which is a group of one or more containers. Adversaries call the API server via `curl` or other tools, allowing them to obtain further information about the environment such as pods, deployments, daemonsets, namespaces, or sysvars. They may also run various commands regarding resource management.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Containers

## What to Check

- [ ] Identify if Container CLI/API technique is applicable to target environment
- [ ] Check Containers systems for indicators of Container CLI/API
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Container CLI/API by examining the target platforms (Containers).

2. **Assess Existing Defenses**: Review whether mitigations for T1059.013 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1026 Privileged Account Management

Restrict permissions on API access. RBAC in Kubernetes involve permissions that are additive, meaning there are no explicit "deny" rules. These permissions can be defined within a particular namespace or within cluster-scoped resources. Securing the Docker daemon can be done by using SSH or TLS with certificate authorization. Container management tools such as Docker and Podman may offer ways to run containers as rootless, which prevents them from running with privileged permissions.

### M1038 Execution Prevention

Deny scripting where appropriate. Tools such as Python or Go can utilize Kubernetes and Docker within a client library and execute commands within their application.

## Detection

### Container CLI and API Abuse via Docker/Kubernetes (T1059.013)

## Risk Assessment

| Finding                                | Severity | Impact    |
| -------------------------------------- | -------- | --------- |
| Container CLI/API technique applicable | Medium   | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Docker Desktop CLI](https://docs.docker.com/desktop/features/desktop-cli/)
- [Cisco Talos Blog](https://blog.talosintelligence.com/teamtnt-targeting-aws-alibaba-2/)
- [Intezer](https://intezer.com/blog/watch-your-containers-doki-infecting-docker-servers-in-the-cloud/)
- [aquasec](https://www.aquasec.com/blog/teamtnt-reemerged-with-new-aggressive-cloud-campaign/)
- [Atomic Red Team - T1059.013](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1059.013)
- [MITRE ATT&CK - T1059.013](https://attack.mitre.org/techniques/T1059/013)
