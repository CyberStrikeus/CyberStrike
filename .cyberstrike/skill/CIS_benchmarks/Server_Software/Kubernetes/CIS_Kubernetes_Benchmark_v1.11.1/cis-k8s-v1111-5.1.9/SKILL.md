---
name: cis-k8s-v1111-5.1.9
description: "Minimize access to create persistent volumes (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, policies, rbac, service-accounts, privilege-escalation]
cis_id: "5.1.9"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.9 Minimize access to create persistent volumes (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

The ability to create persistent volumes in a cluster can provide an opportunity for privilege escalation, via the creation of `hostPath` volumes. As persistent volumes are not covered by Pod Security Admission, a user with access to create persistent volumes may be able to get access to sensitive files from the underlying host even where restrictive Pod Security Admission policies are in place.

## Rationale

The ability to create persistent volumes in a cluster opens up possibilities for privilege escalation and should be restricted, where possible.

## Impact

None

## Audit

Review the users who have create access to `PersistentVolume` objects in the Kubernetes API.

## Remediation

Where possible, remove `create` access to `PersistentVolume` objects in the cluster.

## Default Value

None

## References

1. https://kubernetes.io/docs/concepts/security/rbac-good-practices/#persistent-volume-creation

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | X |
| v7 | 14 Controlled Access Based on the Need to Know | | | |
