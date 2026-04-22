---
name: cis-k8s-v200-3.2.1
description: "Ensure that a minimal audit policy is created (Manual)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane-config, logging]
cis_id: "3.2.1"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Kubernetes Benchmark v2.0.0 - Control 3.2.1

## Profile Applicability
- **Level:** 1 - Master Node

## Description
Kubernetes can audit the details of requests made to the API server. The `--audit-policy-file` flag must be set for this logging to be enabled.

## Rationale
Logging is an important detective control for all systems, to detect potential unauthorised access.

## Impact
Audit logs will be created on the master nodes, which will consume disk space. Care should be taken to avoid generating too large volumes of log information as this could impact the available of the cluster nodes.

## Audit Procedure

Run the following command on one of the cluster master nodes:

```bash
ps -ef | grep kube-apiserver
```

Verify that the `--audit-policy-file` is set. Review the contents of the file specified and ensure that it contains a valid audit policy.

## Remediation

Create an audit policy file for your cluster.

## Default Value
Unless the `--audit-policy-file` flag is specified, no auditing will be carried out.

## References
1. https://kubernetes.io/docs/tasks/debug-application-cluster/audit/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs<br/>Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets. | ● | ● | ● |
| v7 | 6.2 Activate audit logging<br/>Ensure that local logging has been enabled on all systems and networking devices. | ● | ● | ● |

## Profile
**Level 1 - Master Node** (Manual)
