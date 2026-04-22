---
name: "T1053.007_container-orchestration-job"
description: "Adversaries may abuse task scheduling functionality provided by container orchestration tools such as Kubernetes to schedule deployment of containers configured to execute malicious code."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1053.007
  - execution
  - persistence
  - privilege-escalation
  - containers
  - sub-technique
technique_id: "T1053.007"
tactic: "execution"
all_tactics:
  - execution
  - persistence
  - privilege-escalation
platforms:
  - Containers
mitre_url: "https://attack.mitre.org/techniques/T1053/007"
tech_stack:
  - containers
cwe_ids:
  - CWE-94
chains_with:
  - T1053
  - T1053.002
  - T1053.003
  - T1053.005
  - T1053.006
prerequisites:
  - T1053
severity_boost:
  T1053: "Chain with T1053 for deeper attack path"
  T1053.002: "Chain with T1053.002 for deeper attack path"
  T1053.003: "Chain with T1053.003 for deeper attack path"
---

# T1053.007 Container Orchestration Job

> **Sub-technique of:** T1053

## High-Level Description

Adversaries may abuse task scheduling functionality provided by container orchestration tools such as Kubernetes to schedule deployment of containers configured to execute malicious code. Container orchestration jobs run these automated tasks at a specific date and time, similar to cron jobs on a Linux system. Deployments of this type can also be configured to maintain a quantity of containers over time, automating the process of maintaining persistence within a cluster.

In Kubernetes, a CronJob may be used to schedule a Job that runs one or more containers to perform specific tasks. An adversary therefore may utilize a CronJob to schedule deployment of a Job that executes malicious code in various nodes within a cluster.

## Kill Chain Phase

- Execution (TA0002)
- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Containers

## What to Check

- [ ] Identify if Container Orchestration Job technique is applicable to target environment
- [ ] Check Containers systems for indicators of Container Orchestration Job
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: ListCronjobs

Kubernetes Job is a controller that creates one or more pods and ensures that a specified number of them successfully terminate. Kubernetes Job can be used to run containers that perform finite tasks for batch jobs. Kubernetes CronJob is used to schedule Jobs. Attackers may use Kubernetes CronJob for scheduling execution of malicious code that would run as a container in the cluster.

**Supported Platforms:** containers

```bash
kubectl get cronjobs -n #{namespace}
```

**Dependencies:**

- kubectl must be installed

### Atomic Test 2: CreateCronjob

Kubernetes Job is a controller that creates one or more pods and ensures that a specified number of them successfully terminate. Kubernetes Job can be used to run containers that perform finite tasks for batch jobs. Kubernetes CronJob is used to schedule Jobs. Attackers may use Kubernetes CronJob for scheduling execution of malicious code that would run as a container in the cluster.

**Supported Platforms:** containers

```bash
kubectl create -f src/cronjob.yaml -n #{namespace}
```

**Dependencies:**

- kubectl must be installed

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Container Orchestration Job by examining the target platforms (Containers).

2. **Assess Existing Defenses**: Review whether mitigations for T1053.007 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1018 User Account Management

Limit privileges of user accounts and remediate privilege escalation vectors so only authorized administrators can create container orchestration jobs.

### M1026 Privileged Account Management

Ensure containers are not running as root by default. In Kubernetes environments, consider defining Pod Security Standards that prevent pods from running privileged containers.

## Detection

### Detection of Malicious Kubernetes CronJob Scheduling

## Risk Assessment

| Finding                                          | Severity | Impact    |
| ------------------------------------------------ | -------- | --------- |
| Container Orchestration Job technique applicable | Low      | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Kubernetes CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)
- [Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Threat Matrix for Kubernetes](https://www.microsoft.com/security/blog/2020/04/02/attack-matrix-kubernetes/)
- [Atomic Red Team - T1053.007](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1053.007)
- [MITRE ATT&CK - T1053.007](https://attack.mitre.org/techniques/T1053/007)
