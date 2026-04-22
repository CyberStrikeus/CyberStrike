---
name: cis-aks-v170-4.1.2
description: "Minimize access to secrets (Automated)"
category: cis-aks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, rbac, service-accounts, secrets, access-control]
cis_id: "4.1.2"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.7.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.2 Minimize access to secrets (Automated)

## Profile Applicability

- Level 1

## Description

The Kubernetes API stores secrets, which may be service account tokens for the Kubernetes API or credentials used by workloads in the cluster. Access to these secrets should be restricted to the smallest possible group of users to reduce the risk of privilege escalation.

## Rationale

Inappropriate access to secrets stored within the Kubernetes cluster can allow for an attacker to gain additional access to the Kubernetes cluster or external resources whose credentials are stored as secrets.

## Impact

Care should be taken not to remove access to secrets to system components which require this for their operation.

## Audit

Review the users who have `get`, `list` or `watch` access to `secrets` objects in the Kubernetes API.

## Remediation

Where possible, remove `get`, `list` and `watch` access to `secret` objects in the cluster.

## Default Value

By default, the following list of principals have `get` privileges on `secret` objects:

| CLUSTERROLEBINDING | SUBJECT |
|---|---|
| cluster-admin (Group) | system:masters |
| system:controller:clusterrole-aggregation-controller (ServiceAccount kube-system) | clusterrole-aggregation-controller |
| system:controller:expand-controller (ServiceAccount kube-system) | expand-controller |
| system:controller:generic-garbage-collector (ServiceAccount kube-system) | generic-garbage-collector |
| system:controller:namespace-controller (ServiceAccount kube-system) | namespace-controller |
| system:controller:persistent-volume-binder (ServiceAccount kube-system) | persistent-volume-binder |
| system:kube-controller-manager (User) | system:kube-controller-manager |

## References

1. [https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-identity-management#im-7-eliminate-unintended-credential-exposure](https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-identity-management#im-7-eliminate-unintended-credential-exposure)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process | x | x | x |
| v7 | 5.2 Maintain Secure Images | | x | x |
