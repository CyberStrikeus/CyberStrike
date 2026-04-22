---
name: cis-k8s-v1111-5.1.11
description: "Minimize access to the approval sub-resource of certificatesigningrequests objects (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, policies, rbac, service-accounts, privilege-escalation]
cis_id: "5.1.11"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.11 Minimize access to the approval sub-resource of certificatesigningrequests objects (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Users with access to the update the `approval` sub-resource of `CertificateSigningRequests` objects can approve new client certificates for the Kubernetes API effectively allowing them to create new high-privileged user accounts.

This can allow for privilege escalation to full cluster administrator, depending on users configured in the cluster.

## Rationale

The ability to update certificate signing requests should be limited.

## Impact

None

## Audit

Review the users who have access to update the `approval` sub-resource of `CertificateSigningRequests` objects in the Kubernetes API.

## Remediation

Where possible, remove access to the `approval` sub-resource of `CertificateSigningRequests` objects.

## Default Value

None

## References

1. https://kubernetes.io/docs/concepts/security/rbac-good-practices/#csrs-and-certificate-issuing

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | X |
| v7 | 14 Controlled Access Based on the Need to Know | | | |
