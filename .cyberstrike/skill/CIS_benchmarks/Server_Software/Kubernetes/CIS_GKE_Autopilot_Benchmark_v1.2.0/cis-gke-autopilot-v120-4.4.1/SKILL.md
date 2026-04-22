---
name: cis-gke-autopilot-v120-4.4.1
description: "Consider external secret storage (Manual)"
category: cis-gke-autopilot
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gke-autopilot, kubernetes, gcp, secrets, encryption, secret-management, external-secrets]
cis_id: "4.4.1"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Autopilot Benchmark v1.2.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.4.1 Consider external secret storage (Manual)

## Profile Applicability

- Level 2

## Description

Consider the use of an external secrets storage and management system instead of using Kubernetes Secrets directly, if more complex secret management is required. Ensure the solution requires authentication to access secrets, has auditing of access to and use of secrets, and encrypts secrets. Some solutions also make it easier to rotate secrets.

## Rationale

Kubernetes supports secrets as first-class objects, but care needs to be taken to ensure that access to secrets is carefully limited. Using an external secrets provider can ease the management of access to secrets, especially where secrets are used across both Kubernetes and non-Kubernetes environments.

## Impact

None

## Audit

Review your secrets management implementation.

## Remediation

Refer to the secrets management options offered by the cloud service provider or a third-party secrets management solution.

## Default Value

By default, no external secret management is configured.

## References

1. https://kubernetes.io/docs/concepts/configuration/secret/
2. https://cloud.google.com/secret-manager/docs/overview

## CIS Controls

| Controls Version | Control            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------ | ---- | ---- | ---- |
| v8               | 3 Data Protection  |      |      |      |
| v7               | 13 Data Protection |      |      |      |
