---
name: cis-k8s-v1111-5.1.4
description: "Minimize access to create pods (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, policies, rbac, service-accounts, privilege-escalation]
cis_id: "5.1.4"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.4 Minimize access to create pods (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

The ability to create pods in a namespace can provide a number of opportunities for privilege escalation, such as assigning privileged service accounts to these pods or mounting hostPaths with access to sensitive data (unless Pod Security Policies are implemented to restrict this access).

As such, access to create new pods should be restricted to the smallest possible group of users.

## Rationale

The ability to create pods in a cluster opens up possibilities for privilege escalation and should be restricted, where possible.

## Impact

Care should be taken not to remove access to pods to system components which require this for their operation.

## Audit

Review the users who have create access to pod objects in the Kubernetes API.

## Remediation

Where possible, remove `create` access to `pod` objects in the cluster.

## Default Value

By default in a kubeadm cluster the following list of principals have `create` privileges on `pod` objects:

| CLUSTERROLEBINDING | SUBJECT |
|---|---|
| cluster-admin | system:masters |
| system:controller:clusterrole-aggregation-controller | clusterrole-aggregation-controller |
| system:controller:daemon-set-controller | daemon-set-controller |
| system:controller:job-controller | job-controller |
| system:controller:persistent-volume-binder | persistent-volume-binder |
| system:controller:replicaset-controller | replicaset-controller |
| system:controller:replication-controller | replication-controller |
| system:controller:statefulset-controller | statefulset-controller |

## References

None

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | X |
| v7 | 14 Controlled Access Based on the Need to Know | | | |
