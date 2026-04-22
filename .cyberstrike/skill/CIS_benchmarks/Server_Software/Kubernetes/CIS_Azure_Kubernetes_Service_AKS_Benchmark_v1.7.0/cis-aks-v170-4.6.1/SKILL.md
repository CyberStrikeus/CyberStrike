---
name: cis-aks-v170-4.6.1
description: "Create administrative boundaries between resources using namespaces (Manual)"
category: cis-aks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, general-policies, namespaces, resource-isolation, administrative-boundaries]
cis_id: "4.6.1"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.7.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.6.1 Create administrative boundaries between resources using namespaces (Manual)

## Profile Applicability

- Level 1

## Description

Use namespaces to isolate your Kubernetes objects.

## Rationale

Limiting the scope of user permissions can reduce the impact of mistakes or malicious activities. A Kubernetes namespace allows you to partition created resources into logically named groups. Resources created in one namespace can be hidden from other namespaces. By default, each resource created by a user in an Azure AKS cluster runs in a default namespace, called `default`. You can create additional namespaces and attach resources and users to them. You can use Kubernetes Authorization plugins to create policies that segregate access to namespace resources between different users.

## Impact

You need to switch between namespaces for administration.

## Audit

Run the below command and review the namespaces created in the cluster.

```bash
kubectl get namespaces
```

Ensure that these namespaces are the ones you need and are adequately administered as per your requirements.

## Remediation

Follow the documentation and create namespaces for objects in your deployment as you need them.

## Default Value

When you create an AKS cluster, the following namespaces are available:

| NAMESPACE | Description |
|---|---|
| default | Where pods and deployments are created by default when none is provided. In smaller environments, you can deploy applications directly into the default namespace without creating additional logical separations. When you interact with the Kubernetes API, such as with kubectl get pods, the default namespace is used when none is specified. |
| kube-system | Where core resources exist, such as network features like DNS and proxy, or the Kubernetes dashboard. You typically don't deploy your own applications into this namespace. |
| kube-public | Typically not used, but can be used for resources to be visible across the whole cluster, and can be viewed by any user. |

## References

1. [https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/)
2. [http://blog.kubernetes.io/2016/08/security-best-practices-kubernetes-deployment.html](http://blog.kubernetes.io/2016/08/security-best-practices-kubernetes-deployment.html)
3. [https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-governance-strategy#gs-1-define-asset-management-and-data-protection-strategy](https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-governance-strategy#gs-1-define-asset-management-and-data-protection-strategy)
4. [https://docs.microsoft.com/en-us/azure/aks/concepts-clusters-workloads](https://docs.microsoft.com/en-us/azure/aks/concepts-clusters-workloads)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4.6 Securely Manage Enterprise Assets and Software | x | x | x |
| v7 | 14 Controlled Access Based on the Need to Know | | | |
