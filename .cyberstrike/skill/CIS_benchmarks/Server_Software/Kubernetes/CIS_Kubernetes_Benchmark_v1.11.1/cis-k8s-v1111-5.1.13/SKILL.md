---
name: cis-k8s-v1111-5.1.13
description: "Minimize access to the service account token creation (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, policies, rbac, service-accounts, token-creation]
cis_id: "5.1.13"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.13 Minimize access to the service account token creation (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Users with rights to create new service account tokens at a cluster level, can create long-lived privileged credentials in the cluster. This could allow for privilege escalation and persistent access to the cluster, even if the users account has been revoked.

## Rationale

The ability to create service account tokens should be limited.

## Impact

None

## Audit

Review the users who have access to create the `token` sub-resource of `serviceaccount` objects in the Kubernetes API.

## Remediation

Where possible, remove access to the `token` sub-resource of `serviceaccount` objects.

## Default Value

None

## References

1. https://kubernetes.io/docs/concepts/security/rbac-good-practices/#token-request

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control |      |      | X    |
| v7               | 14 Controlled Access Based on the Need to Know    |      |      |      |
