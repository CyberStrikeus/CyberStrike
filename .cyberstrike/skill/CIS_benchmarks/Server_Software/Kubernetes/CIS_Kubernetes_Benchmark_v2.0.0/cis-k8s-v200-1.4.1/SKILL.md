---
name: cis-k8s-v200-1.4.1
description: "Ensure that the --profiling argument is set to false (Automated)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, scheduler]
cis_id: "1.4.1"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Kubernetes Benchmark v2.0.0 - Control 1.4.1

## Profile Applicability
- **Level:** 1 - Master Node

## Description
Disable profiling, if not needed.

## Rationale
Profiling allows for the identification of specific performance bottlenecks. It generates a significant amount of program data that could potentially be exploited to uncover system and program details. If you are not experiencing any bottlenecks and do not need the profiler for troubleshooting purposes, it is recommended to turn it off to reduce the potential attack surface.

## Impact
Profiling information would not be available.

## Audit Procedure

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-scheduler
```

Verify that the `--profiling` argument is set to `false`.

## Remediation

Edit the Scheduler pod specification file `/etc/kubernetes/manifests/kube-scheduler.yaml` file on the Control Plane node and set the below parameter.

```
--profiling=false
```

## Default Value
By default, profiling is enabled.

## References
1. https://kubernetes.io/docs/admin/kube-scheduler/
2. https://github.com/kubernetes/community/blob/master/contributors/devel/profiling.md

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software<br/>Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function. | | ● | ● |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running<br/>Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system. | | ● | ● |

## Profile
**Level 1 - Master Node** (Automated)
