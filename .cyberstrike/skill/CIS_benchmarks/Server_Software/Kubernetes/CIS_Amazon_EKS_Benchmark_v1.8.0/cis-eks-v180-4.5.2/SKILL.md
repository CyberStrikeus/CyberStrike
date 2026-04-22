---
name: cis-eks-v180-4.5.2
description: "The default namespace should not be used (Automated)"
category: cis-eks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, general-policies, namespaces, default-namespace, resource-isolation]
cis_id: "4.5.2"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.8.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.5.2 The default namespace should not be used (Automated)

## Profile Applicability

- Level 1

## Description

Kubernetes provides a `default` namespace, where objects are placed if no namespace is specified for them. Placing objects in this namespace makes application of RBAC and other controls more difficult.

## Rationale

Resources in a Kubernetes cluster should be segregated by namespace, to allow for security controls to be applied at that level and to make it easier to manage resources.

## Impact

None.

## Audit Procedure

Run the below command to list objects in the default namespace:

```bash
kubectl get all -n default
```

The only entries there should be system-managed resources such as the `kubernetes` service.

```bash
# Check for user-created resources in default namespace
kubectl get pods -n default
kubectl get deployments -n default
kubectl get services -n default | grep -v kubernetes
kubectl get configmaps -n default | grep -v kube-root-ca
```

## Remediation

Ensure that namespaces are created to allow for appropriate segregation of Kubernetes resources and that all new resources are created in a specific namespace.

## Default Value

Unless a namespace is specified, all Kubernetes resources are created in the `default` namespace.

## References

1. https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/

## CIS Controls

| Controls Version | Control                                                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 12.8 Establish and Maintain Dedicated Computing Resources for All Administrative Work |      |      | x    |
| v7               | 12.1 Maintain an Inventory of Network Boundaries                                      | x    | x    | x    |
