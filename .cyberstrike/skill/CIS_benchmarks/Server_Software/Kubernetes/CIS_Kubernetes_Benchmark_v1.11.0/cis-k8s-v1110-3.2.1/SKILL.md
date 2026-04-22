---
name: cis-k8s-v1110-3.2.1
description: "Ensure that a minimal audit policy is created (Manual)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane-config, logging, audit-policy]
cis_id: "3.2.1"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.2.1 Ensure that a minimal audit policy is created (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Kubernetes can audit the details of requests made to the API server. The `--audit-policy-file` flag must be set for this logging to be enabled.

## Rationale

Logging is an important detective control for all systems, to detect potential unauthorised access.

## Impact

Audit logs will be created on the master nodes, which will consume disk space. Care should be taken to avoid generating too large volumes of log information as this could impact the available of the cluster nodes.

## Audit

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
| v8 | 8.2 Collect Audit Logs | X | X | X |
| v7 | 6.2 Activate audit logging | X | X | X |
