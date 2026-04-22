---
name: cis-k8s-v1110-5.1.4
description: "Minimize access to create pods (Manual)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, policies, rbac, service-accounts, pod-creation]
cis_id: "5.1.4"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
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
| cluster-admin (Group) | system:masters |
| system:controller:clusterrole-aggregation-controller (ServiceAccount kube-system) | clusterrole-aggregation-controller |
| system:controller:daemon-set-controller (ServiceAccount kube-system) | daemon-set-controller |
| system:controller:job-controller (ServiceAccount kube-system) | job-controller |
| system:controller:persistent-volume-binder (ServiceAccount kube-system) | persistent-volume-binder |
| system:controller:replicaset-controller (ServiceAccount kube-system) | replicaset-controller |
| system:controller:replication-controller (ServiceAccount kube-system) | replication-controller |
| system:controller:statefulset-controller (ServiceAccount kube-system) | statefulset-controller |

## References

None specified.
