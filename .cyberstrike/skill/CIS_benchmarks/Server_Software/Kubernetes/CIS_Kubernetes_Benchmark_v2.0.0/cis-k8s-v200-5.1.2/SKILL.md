---
name: cis-k8s-v200-5.1.2
description: "Minimize access to secrets (Manual)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, policies, rbac, service-accounts, secrets, access-control]
cis_id: "5.1.2"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
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

| CLUSTERROLEBINDING                                                                 | SUBJECT                            |
| ---------------------------------------------------------------------------------- | ---------------------------------- |
| cluster-admin (Group)                                                              | system:masters                     |
| system:controller:clusterrole-aggregation-controller (ServiceAccount, kube-system) | clusterrole-aggregation-controller |
| system:controller:expand-controller (ServiceAccount, kube-system)                  | expand-controller                  |
| system:controller:generic-garbage-collector (ServiceAccount, kube-system)          | generic-garbage-collector          |
| system:controller:namespace-controller (ServiceAccount, kube-system)               | namespace-controller               |
| system:controller:persistent-volume-binder (ServiceAccount, kube-system)           | persistent-volume-binder           |
| system:kube-controller-manager (User)                                              | system:kube-controller-manager     |
