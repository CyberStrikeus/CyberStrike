---
name: cis-aks-v180-4.5.2
description: "Consider external secret storage (Manual)"
category: cis-aks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, secrets, external-secrets, key-vault, secret-management]
cis_id: "4.5.2"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.5.2 Consider external secret storage (Manual)

## Profile Applicability

- Level 2

## Description

Consider the use of an external secrets storage and management system, instead of using Kubernetes Secrets directly, if you have more complex secret management needs. Ensure the solution requires authentication to access secrets, has auditing of access to and use of secrets, and encrypts secrets. Some solutions also make it easier to rotate secrets.

## Rationale

Kubernetes supports secrets as first-class objects, but care needs to be taken to ensure that access to secrets is carefully limited. Using an external secrets provider can ease the management of access to secrets, especially where secrets are used across both Kubernetes and non-Kubernetes environments.

## Impact

None

## Audit

Review your secrets management implementation.

## Remediation

Refer to the secrets management options offered by your cloud provider or a third-party secrets management solution.

## Default Value

By default, no external secret management is configured.

## References

1. [https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-identity-management#im-7-eliminate-unintended-credential-exposure](https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-identity-management#im-7-eliminate-unintended-credential-exposure)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | x | x |
| v8 | 6 Access Control Management | | | |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | x |
