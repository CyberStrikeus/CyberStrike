---
name: cis-k8s-v1111-5.1.2
description: "Minimize access to secrets (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, policies, rbac, service-accounts, secrets]
cis_id: "5.1.2"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.2 Minimize access to secrets (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

The Kubernetes API stores secrets, which may be service account tokens for the Kubernetes API or credentials used by workloads in the cluster. Access to these secrets should be restricted to the smallest possible group of users to reduce the risk of privilege escalation.

## Rationale

Inappropriate access to secrets stored within the Kubernetes cluster can allow for an attacker to gain additional access to the Kubernetes cluster or external resources whose credentials are stored as secrets.

## Impact

Care should be taken not to remove access to secrets to system components which require this for their operation.

## Audit

Review the users who have `get`, `list`, or `watch` access to `secrets` objects in the Kubernetes API.

## Remediation

Where possible, restrict access to secret objects in the cluster by removing get, list, and watch permissions.

## Default Value

By default in a kubeadm cluster the following list of principals have `get` privileges on `secret` objects:

| CLUSTERROLEBINDING | SUBJECT |
|---|---|
| cluster-admin | system:masters |
| system:controller:clusterrole-aggregation-controller | clusterrole-aggregation-controller |
| system:controller:expand-controller | expand-controller |
| system:controller:generic-garbage-collector | generic-garbage-collector |
| system:controller:namespace-controller | namespace-controller |
| system:controller:persistent-volume-binder | persistent-volume-binder |
| system:kube-controller-manager | system:kube-controller-manager |

## References

None

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3 Data Protection | | | |
| v7 | 14 Controlled Access Based on the Need to Know | | | |
