---
name: cis-aks-v170-5.1.3
description: "Minimize cluster access to read-only for Azure Container Registry (ACR) (Manual)"
category: cis-aks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, acr, iam, access-control, least-privilege, read-only]
cis_id: "5.1.3"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.7.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.3 Minimize cluster access to read-only for Azure Container Registry (ACR) (Manual)

## Profile Applicability

- Level 1

## Description

Configure the Cluster Service Account with Storage Object Viewer Role to only allow read-only access to Azure Container Registry (ACR).

## Rationale

The Cluster Service Account does not require administrative access to Azure ACR, only requiring pull access to containers to deploy onto Azure AKS. Restricting permissions follows the principles of least privilege and prevents credentials from being abused beyond the required role.

## Impact

A separate dedicated service account may be required for use by build servers and other robot users pushing or managing container images.

## Audit

Review the Cluster Service Account permissions to ensure it has only read-only (pull) access to Azure Container Registry.

## Remediation

Configure the Cluster Service Account with the appropriate read-only role for ACR access. Use `az aks update` to attach ACR with `AcrPull` role instead of broader permissions.

## References

1. https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-data-protection#dp-2-protect-sensitive-data

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v8 | 7.5 Perform Automated Vulnerability Scans of Internal Enterprise Assets | | x | x |
| v7 | 3.2 Perform Authenticated Vulnerability Scanning | | x | x |
