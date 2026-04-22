---
name: cis-k8s-v1111-5.1.3
description: "Minimize wildcard use in Roles and ClusterRoles (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, policies, rbac, service-accounts, cluster-roles, wildcards]
cis_id: "5.1.3"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.3 Minimize wildcard use in Roles and ClusterRoles (Manual)

## Profile Applicability

- Level 1 - Worker Node

## Description

Kubernetes Roles and ClusterRoles provide access to resources based on sets of objects and actions that can be taken on those objects. It is possible to set either of these to be the wildcard "*" which matches all items.

Use of wildcards is not optimal from a security perspective as it may allow for inadvertent access to be granted when new resources are added to the Kubernetes API either as CRDs or in later versions of the product.

## Rationale

The principle of least privilege recommends that users are provided only the access required for their role and nothing more. The use of wildcard rights grants is likely to provide excessive rights to the Kubernetes API.

## Impact

None

## Audit

Retrieve the roles defined across each namespaces in the cluster and review for wildcards:

```bash
kubectl get roles --all-namespaces -o yaml
```

Retrieve the cluster roles defined in the cluster and review for wildcards:

```bash
kubectl get clusterroles -o yaml
```

## Remediation

Where possible replace any use of wildcards in ClusterRoles and Roles with specific objects or actions.

## Default Value

None

## References

None

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | X |
| v7 | 14 Controlled Access Based on the Need to Know | | | |
