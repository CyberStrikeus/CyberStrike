---
name: cis-aks-v180-5.1.2
description: "Minimize user access to Azure Container Registry (ACR) (Manual)"
category: cis-aks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, acr, iam, access-control, least-privilege]
cis_id: "5.1.2"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.2 Minimize user access to Azure Container Registry (ACR) (Manual)

## Profile Applicability

- Level 1

## Description

Restrict user access to Azure Container Registry (ACR), limiting interaction with build images to only authorized personnel and service accounts.

## Rationale

Weak access control to Azure Container Registry (ACR) may allow malicious users to replace built images with vulnerable containers.

## Impact

Care should be taken not to remove access to Azure ACR for accounts that require this for their operation.

## Audit

Review Azure Container Registry access permissions to ensure only authorized users and service accounts have access.

## Remediation

Azure Container Registry: If you use Azure Container Registry (ACR) as your container image store, you need to grant permissions to the service principal for your AKS cluster to read and pull images. Currently, the recommended configuration is to use the az aks create or az aks update command to integrate with a registry and assign the appropriate role for the service principal. For detailed steps, see Authenticate with Azure Container Registry from Azure Kubernetes Service.

To avoid needing an Owner or Azure account administrator role, you can configure a service principal manually or use an existing service principal to authenticate ACR from AKS. For more information, see ACR authentication with service principals or Authenticate from Kubernetes with a pull secret.

## References

1. https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-privileged-access#pa-7-follow-just-enough-administration-least-privilege-principle

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |
