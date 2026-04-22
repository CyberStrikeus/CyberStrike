---
name: cis-aks-v180-5.5.2
description: "Use Azure RBAC for Kubernetes Authorization (Manual)"
category: cis-aks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, authentication, azure-rbac, authorization, identity]
cis_id: "5.5.2"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.5.2 Use Azure RBAC for Kubernetes Authorization (Manual)

## Profile Applicability

- Level 2

## Description

Azure RBAC for Kubernetes Authorization allows unified management and access control across Azure resources and AKS clusters. This feature enables Azure role assignments to directly control access to Kubernetes resources, providing a single pane of glass for managing both Azure and Kubernetes permissions.

## Rationale

Using Azure RBAC for Kubernetes Authorization centralizes authorization management and provides consistent role-based access control across both Azure and Kubernetes resources. This reduces the complexity of managing separate RBAC systems and ensures that the principle of least privilege is enforced uniformly.

## Audit

Verify that Azure RBAC for Kubernetes Authorization is enabled on the AKS cluster:

```bash
az aks show --name ${CLUSTER_NAME} --resource-group ${RESOURCE_GROUP} --query "aadProfile.enableAzureRbac"
```

The output should be `true` if Azure RBAC for Kubernetes Authorization is enabled.

## Remediation

Enable Azure RBAC for Kubernetes Authorization on the AKS cluster:

```bash
az aks update --name ${CLUSTER_NAME} --resource-group ${RESOURCE_GROUP} --enable-azure-rbac
```

For new clusters:

```bash
az aks create \
  --resource-group ${RESOURCE_GROUP} \
  --name ${CLUSTER_NAME} \
  --enable-aad \
  --enable-azure-rbac
```

## References

1. https://docs.microsoft.com/en-us/azure/aks/manage-azure-rbac
2. https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-privileged-access#pa-7-follow-just-enough-administration-least-privilege-principle

## CIS Controls

| Controls Version | Control                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.6 Centralize Account Management                  |      | x    | x    |
| v8               | 6.8 Define and Maintain Role-Based Access Control  |      |      | x    |
| v7               | 16.2 Configure Centralized Point of Authentication |      | x    | x    |
