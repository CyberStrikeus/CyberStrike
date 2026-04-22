---
name: "T1609_container-administration-command"
description: "Adversaries may abuse a container administration service to execute commands within a container."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1609
  - execution
  - containers
technique_id: "T1609"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Containers
mitre_url: "https://attack.mitre.org/techniques/T1609"
tech_stack:
  - containers
cwe_ids:
  - CWE-94
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1609 Container Administration Command

## High-Level Description

Adversaries may abuse a container administration service to execute commands within a container. A container administration service such as the Docker daemon, the Kubernetes API server, or the kubelet may allow remote management of containers within an environment.

In Docker, adversaries may specify an entrypoint during container deployment that executes a script or command, or they may use a command such as <code>docker exec</code> to execute a command within a running container. In Kubernetes, if an adversary has sufficient permissions, they may gain remote execution in a container in the cluster via interaction with the Kubernetes API server, the kubelet, or by running a command such as <code>kubectl exec</code>.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Containers

## What to Check

- [ ] Identify if Container Administration Command technique is applicable to target environment
- [ ] Check Containers systems for indicators of Container Administration Command
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: ExecIntoContainer

Attackers who have permissions, can run malicious commands in containers in the cluster using exec command (“kubectl exec”). In this method, attackers can use legitimate images, such as an OS image (e.g., Ubuntu) as a backdoor container, and run their malicious code remotely by using “kubectl exec”.

**Supported Platforms:** containers

```bash
kubectl create -f #{path} -n #{namespace}
# wait 3 seconds for the instance to come up
sleep 3
kubectl exec -n #{namespace} busybox -- #{command}
```

**Dependencies:**

- kubectl must be installed

### Atomic Test 2: Docker Exec Into Container

Attackers who have permissions, can run malicious commands in containers in the cluster using exec command (“docker exec”). In this method, attackers can use legitimate images, such as an OS image (e.g., Ubuntu) as a backdoor container, and run their malicious code remotely by using “docker exec”. Kinsing (Golang-based malware) was executed with an Ubuntu container entry point that runs shell scripts.

**Supported Platforms:** containers

```bash
docker build -t t1609  $PathtoAtomicsFolder/T1609/src/
docker run --name t1609_container --rm -itd t1609 bash /tmp/script.sh
docker exec -i t1609_container bash -c "cat /tmp/output.txt"
```

**Dependencies:**

- docker must be installed

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Container Administration Command by examining the target platforms (Containers).

2. **Assess Existing Defenses**: Review whether mitigations for T1609 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1018 User Account Management

Enforce authentication and role-based access control on the container service to restrict users to the least privileges required. When using Kubernetes, avoid giving users wildcard permissions or adding users to the `system:masters` group, and use `RoleBindings` rather than `ClusterRoleBindings` to limit user privileges to specific namespaces.

### M1026 Privileged Account Management

Ensure containers are not running as root by default. In Kubernetes environments, consider defining Pod Security Standards that prevent pods from running privileged containers and using the `NodeRestriction` admission controller to deny the kublet access to nodes and pods outside of the node it belongs to.

### M1042 Disable or Remove Feature or Program

Remove unnecessary tools and software from containers.

### M1035 Limit Access to Resource Over Network

Limit communications with the container service to managed and secured channels, such as local Unix sockets or remote access via SSH. Require secure port access to communicate with the APIs over TLS by disabling unauthenticated access to the Docker API and Kubernetes API Server. In Kubernetes clusters deployed in cloud environments, use native cloud platform features to restrict the IP ranges that are permitted to access to API server. Where possible, consider enabling just-in-time (JIT) access to the Kubernetes API to place additional restrictions on access.

### M1038 Execution Prevention

Use read-only containers, read-only file systems, and minimal images when possible to prevent the execution of commands. Where possible, also consider using application control and software restriction tools (such as those provided by SELinux) to restrict access to files, processes, and system calls in containers.

## Detection

### Detection Strategy for Container Administration Command Abuse

## Risk Assessment

| Finding                                               | Severity | Impact    |
| ----------------------------------------------------- | -------- | --------- |
| Container Administration Command technique applicable | Low      | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Docker Exec](https://docs.docker.com/engine/reference/commandline/exec/)
- [Docker Entrypoint](https://docs.docker.com/engine/reference/run/#entrypoint-default-command-to-execute-at-runtime)
- [Docker Daemon CLI](https://docs.docker.com/engine/reference/commandline/dockerd/)
- [Kubectl Exec Get Shell](https://kubernetes.io/docs/tasks/debug-application-cluster/get-shell-running-container/)
- [Kubernetes Kubelet](https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/)
- [Kubernetes API](https://kubernetes.io/docs/concepts/overview/kubernetes-api/)
- [Atomic Red Team - T1609](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1609)
- [MITRE ATT&CK - T1609](https://attack.mitre.org/techniques/T1609)
