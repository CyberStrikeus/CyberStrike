---
name: cis-aks-v170-4.6.3
description: "The default namespace should not be used (Automated)"
category: cis-aks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, namespaces, general-policies]
cis_id: "4.6.3"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.7.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.6.3 The default namespace should not be used (Automated)

## Profile Applicability

- Level 2

## Description

Kubernetes provides a default namespace, where objects are placed if no namespace is specified for them. Placing objects in this namespace makes application of RBAC and other controls more difficult.

## Rationale

Resources in a Kubernetes cluster should be segregated by namespace, to allow for security controls to be applied at that level and to make it easier to manage resources.

## Audit Procedure

Run the following command to list objects in the default namespace:

```bash
kubectl get all -n default
```

The only entries there should be system-managed resources such as the `kubernetes` service.

## Remediation

Ensure that namespaces are created to allow for appropriate segregation of Kubernetes resources and that all new resources are created in a specific namespace.

```bash
kubectl create namespace <namespace_name>
```

## Default Value

Unless a namespace is specified, all Kubernetes resources are created in the default namespace.

## References

1. https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/

## CIS Controls

| Controls Version | Control                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.6 Securely Manage Enterprise Assets and Software | ●    | ●    | ●    |
| v7               | 14 Controlled Access Based on the Need to Know     |      |      |      |

## Profile Applicability

- Level 2
