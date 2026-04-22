---
name: cis-aks-v180-5.3.1
description: "Ensure Kubernetes Secrets are encrypted (Manual)"
category: cis-aks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, kms, encryption, secrets, data-protection]
cis_id: "5.3.1"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.1 Ensure Kubernetes Secrets are encrypted (Manual)

## Profile Applicability

- Level 1

## Description

Encryption at Rest is a common security requirement. In Azure, organizations can encrypt data at rest without the risk or cost of a custom key management solution. Organizations have the option of letting Azure completely manage Encryption at Rest. Additionally, organizations have various options to closely manage encryption or encryption keys.

## Rationale

Encrypting Kubernetes Secrets at rest ensures that sensitive data such as credentials, tokens, and keys stored in etcd are protected from unauthorized access even if the underlying storage is compromised.

## Audit

Verify that encryption at rest is configured for the AKS cluster and that Kubernetes secrets are encrypted using Azure Key Vault or the platform-managed encryption mechanism.

## Remediation

Configure encryption at rest for Kubernetes secrets using Azure Key Vault or Azure's platform-managed encryption. Ensure that the AKS cluster is configured to use KMS encryption for etcd data.

## References

1. https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-data-protection#dp-5-encrypt-sensitive-data-at-rest

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | x | x |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | x |
