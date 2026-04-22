---
name: cis-eks-v180-4.1.6
description: "Ensure that Service Account Tokens are only mounted where necessary (Manual)"
category: cis-eks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, rbac, service-accounts, token-mounting, least-privilege]
cis_id: "4.1.6"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.8.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.6 Ensure that Service Account Tokens are only mounted where necessary (Manual)

## Profile Applicability

- Level 1

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

```bash
kubectl get pods --all-namespaces -o yaml | grep automountServiceAccountToken
kubectl get serviceaccounts --all-namespaces -o yaml | grep automountServiceAccountToken
```

## Remediation

Regularly review pod and service account objects in the cluster to ensure that the `automountServiceAccountToken` setting is `false` for pods and accounts that do not explicitly require API server access.

```yaml
automountServiceAccountToken: false
```

## Default Value

By default, all pods get a service account token mounted in them.

## References

1. https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 14.7 Enforce Access Control to Data through Automated Tools                     |      |      | x    |
