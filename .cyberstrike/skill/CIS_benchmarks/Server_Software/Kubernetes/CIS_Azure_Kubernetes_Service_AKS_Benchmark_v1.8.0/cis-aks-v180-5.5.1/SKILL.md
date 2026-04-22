---
name: cis-aks-v180-5.5.1
description: "Manage Kubernetes RBAC users with Azure AD (Manual)"
category: cis-aks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, authentication, azure-ad, rbac, identity]
cis_id: "5.5.1"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.5.1 Manage Kubernetes RBAC users with Azure AD (Manual)

## Profile Applicability

- Level 2

## Description

Azure Kubernetes Service (AKS) can be configured to use Azure Active Directory (AD) for user authentication. In this configuration, you sign in to an AKS cluster using an Azure AD authentication token. You can also configure Kubernetes role-based access control (Kubernetes RBAC) to limit access to cluster resources based a user's identity or group membership.

## Rationale

Kubernetes RBAC and AKS help you secure your cluster access and provide only the minimum required permissions to developers and operators.

## Audit

Review AKS cluster configuration to verify that Azure AD integration is enabled and Kubernetes RBAC users are managed through Azure AD identities and groups.

## Remediation

Configure AKS cluster to integrate with Azure Active Directory for user authentication. Enable Azure AD-managed Kubernetes RBAC to manage cluster access through Azure AD groups and users.

## References

1. https://docs.microsoft.com/en-us/azure/aks/azure-ad-rbac
2. https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-privileged-access#pa-7-follow-just-enough-administration-least-privilege-principle

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.6 Centralize Account Management | | x | x |
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | x |
| v7 | 16.2 Configure Centralized Point of Authentication | | x | x |
