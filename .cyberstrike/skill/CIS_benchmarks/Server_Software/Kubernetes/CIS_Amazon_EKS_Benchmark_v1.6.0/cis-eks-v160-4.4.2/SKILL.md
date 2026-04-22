---
name: cis-eks-v160-4.4.2
description: "Consider external secret storage (Manual)"
category: cis-eks
version: "1.6.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, secrets, external-secrets, vault, secrets-manager]
cis_id: "4.4.2"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.6.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.4.2 Consider external secret storage (Manual)

## Profile Applicability

- Level 1

## Description

Consider the use of an external secrets storage and management system, instead of using Kubernetes Secrets directly, if you have more complex secret management needs. Ensure the solution requires authentication to access secrets, has auditing of access to and use of secrets, and encrypts secrets. Some solutions also make it easier to rotate secrets.

## Rationale

Kubernetes supports secrets as first-class objects, but care needs to be taken to ensure that access to secrets is carefully limited. Using an external secrets provider can ease the management of access to secrets, especially where secrets are used across both Kubernetes and non-Kubernetes environments.

## Impact

None.

## Audit Procedure

Review your secrets management implementation.

```bash
# Check if external secrets operator is installed
kubectl get pods --all-namespaces | grep -i "external-secret\|sealed-secret\|vault"

# Check for SecretStore/ClusterSecretStore resources
kubectl get secretstores --all-namespaces 2>/dev/null
kubectl get clustersecretstores 2>/dev/null
```

## Remediation

Refer to the secrets management options offered by your cloud provider or a third-party secrets management solution.

## Default Value

By default, no external secret management is configured.

## References

None specified.

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest        |      | x    | x    |
| v7               | 14.8 Encrypt Sensitive Information at Rest |      |      | x    |
