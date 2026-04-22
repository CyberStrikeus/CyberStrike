---
name: cis-k8s-v1120-5.1.6
description: "Ensure that Service Account Tokens are only mounted where necessary (Manual)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, policies, rbac, service-accounts]
cis_id: "5.1.6"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.6 Ensure that Service Account Tokens are only mounted where necessary (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Service accounts tokens should not be mounted in pods except where the workload running in the pod explicitly needs to communicate with the API server.

## Rationale

Mounting service account tokens inside pods can provide an avenue for privilege escalation attacks where an attacker is able to compromise a single pod in the cluster.

Avoiding mounting these tokens removes this attack avenue.

## Impact

Pods mounted without service account tokens will not be able to communicate with the API server, except where the resource is available to unauthenticated principals.

## Audit Procedure

Review pod and service account objects in the cluster and ensure that the option below is set, unless the resource explicitly requires this access.

```yaml
automountServiceAccountToken: false
```

## Remediation

Modify the definition of pods and service accounts which do not need to mount service account tokens to disable it.

## Default Value

By default, all pods get a service account token mounted in them.

## References

1. https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/

## CIS Controls

| Controls Version | Control            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------ | ---- | ---- | ---- |
| v8               | 3 Data Protection  |      |      |      |
| v7               | 13 Data Protection |      |      |      |
