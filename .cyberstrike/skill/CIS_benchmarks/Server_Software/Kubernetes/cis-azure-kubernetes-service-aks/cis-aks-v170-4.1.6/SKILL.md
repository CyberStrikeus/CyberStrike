---
name: cis-aks-v170-4.1.6
description: "Ensure Service Account Tokens are only mounted where necessary (Automated)"
category: cis-aks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, rbac, service-accounts, token-mounting, automount]
cis_id: "4.1.6"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.7.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.6 Ensure Service Account Tokens are only mounted where necessary (Automated)

## Profile Applicability

- Level 1

## Description

Service accounts tokens should not be mounted in pods except where the workload running in the pod explicitly needs to communicate with the API server.

## Rationale

Mounting service account tokens inside pods can provide an avenue for privilege escalation attacks where an attacker is able to compromise a single pod in the cluster.

Avoiding mounting these tokens removes this attack avenue.

## Impact

Pods mounted without service account tokens will not be able to communicate with the API server, except where the resource is available to unauthenticated principals.

## Audit

Review pod and service account objects in the cluster and ensure that the option below is set, unless the resource explicitly requires this access.

Set SERVICE_ACCOUNT and POD variables to appropriate values:

```yaml
automountServiceAccountToken: false
```

## Remediation

Modify the definition of pods and service accounts which do not need to mount service account tokens to disable it.

## Default Value

By default, all pods get a service account token mounted in them.

## References

1. [https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/)
2. [https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-identity-management#im-2-manage-application-identities-securely-and-automatically](https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-identity-management#im-2-manage-application-identities-securely-and-automatically)

## CIS Controls

| Controls Version | Control                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.1 Establish and Maintain a Secure Configuration Process | x    | x    | x    |
| v7               | 5.2 Maintain Secure Images                                |      | x    | x    |
