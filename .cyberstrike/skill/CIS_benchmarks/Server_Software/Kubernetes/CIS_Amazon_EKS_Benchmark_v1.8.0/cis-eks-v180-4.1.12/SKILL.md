---
name: cis-eks-v180-4.1.12
description: "Minimize access to the service account token creation (Manual)"
category: cis-eks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, rbac, service-accounts, token-creation]
cis_id: "4.1.12"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.8.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.12 Minimize access to the service account token creation (Manual)

## Profile Applicability

- Level 1

## Description

Users with rights to create new service account tokens at a cluster level, can create long-lived privileged credentials in the cluster. This could allow for privilege escalation and persistent access to the cluster, even if the users account has been revoked.

## Rationale

The ability to create service account tokens should be limited.

## Audit Procedure

Review the users who have access to create the `token` sub-resource of `serviceaccount` objects in the Kubernetes API.

```bash
kubectl get clusterroles -o json | jq -r '.items[] | select(.rules[]? | select(.resources[]? == "serviceaccounts/token")) | .metadata.name'
```

## Remediation

Where possible, remove access to the `token` sub-resource of `serviceaccount` objects.

## Default Value

By default, the cluster-admin ClusterRole has access to create service account tokens.

## References

1. https://kubernetes.io/docs/concepts/security/rbac-good-practices/#token-request

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control |      |      | ●    |

## Profile Applicability

- Level 1
