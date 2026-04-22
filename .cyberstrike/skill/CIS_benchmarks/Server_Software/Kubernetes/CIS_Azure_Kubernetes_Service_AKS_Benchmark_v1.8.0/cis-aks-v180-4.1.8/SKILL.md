---
name: cis-aks-v180-4.1.8
description: "Minimize access to create persistent volumes (Manual)"
category: cis-aks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, rbac, service-accounts, persistent-volumes, privilege-escalation]
cis_id: "4.1.8"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.8 Minimize access to create persistent volumes (Manual)

## Profile Applicability

- Level 1

## Description

The ability to create persistent volumes in a cluster can provide an opportunity for privilege escalation, via the creation of `hostPath` volumes. As persistent volumes are not covered by Pod Security Admission, a user with access to create persistent volumes may be able to get access to sensitive files from the underlying host even where restrictive Pod Security Admission policies are in place.

## Rationale

The ability to create persistent volumes in a cluster opens up possibilities for privilege escalation and should be restricted, where possible.

## Audit

Review the users who have create access to `PersistentVolume` objects in the Kubernetes API.

## Remediation

Where possible, remove `create` access to `PersistentVolume` objects in the cluster.

## References

1. [https://kubernetes.io/docs/concepts/security/rbac-good-practices/#persistent-volume-creation](https://kubernetes.io/docs/concepts/security/rbac-good-practices/#persistent-volume-creation)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | x |
