---
name: cis-aks-v170-4.1.3
description: "Minimize wildcard use in Roles and ClusterRoles (Automated)"
category: cis-aks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, rbac, service-accounts, wildcard, least-privilege]
cis_id: "4.1.3"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.7.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.3 Minimize wildcard use in Roles and ClusterRoles (Automated)

## Profile Applicability

- Level 1

## Description

Kubernetes Roles and ClusterRoles provide access to resources based on sets of objects and actions that can be taken on those objects. It is possible to set either of these to be the wildcard "*" which matches all items.

Use of wildcards is not optimal from a security perspective as it may allow for inadvertent access to be granted when new resources are added to the Kubernetes API either as CRDs or in later versions of the product.

## Rationale

The principle of least privilege recommends that users are provided only the access required for their role and nothing more. The use of wildcard rights grants is likely to provide excessive rights to the Kubernetes API.

## Audit

Retrieve the roles defined across each namespace in the cluster and review for wildcards:

```bash
kubectl get roles --all-namespaces -o yaml
```

Retrieve the cluster roles defined in the cluster and review for wildcards:

```bash
kubectl get clusterroles -o yaml
```

## Remediation

Where possible replace any use of wildcards in clusterroles and roles with specific objects or actions.

## References

1. [https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-privileged-access#pa-7-follow-just-enough-administration-least-privilege-principle](https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-privileged-access#pa-7-follow-just-enough-administration-least-privilege-principle)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process | x | x | x |
| v7 | 5.1 Establish Secure Configurations | x | x | x |
