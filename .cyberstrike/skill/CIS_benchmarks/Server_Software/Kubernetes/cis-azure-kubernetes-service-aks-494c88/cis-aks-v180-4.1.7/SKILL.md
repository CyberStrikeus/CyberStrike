---
name: cis-aks-v180-4.1.7
description: "Limit use of Bind, Impersonate and Escalate permissions (Manual)"
category: cis-aks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, rbac, service-accounts, bind, impersonate, escalate, privilege-escalation]
cis_id: "4.1.7"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.7 Limit use of the Bind, Impersonate and Escalate permissions in the Kubernetes cluster (Manual)

## Profile Applicability

- Level 1

## Description

Cluster roles and roles with the impersonate, bind or escalate permissions should not be granted unless strictly required. Each of these permissions allow a particular subject to escalate their privileges beyond those explicitly granted by cluster administrators.

## Rationale

The impersonate privilege allows a subject to impersonate other users gaining their rights to the cluster. The bind privilege allows the subject to add a binding to a cluster role or role which escalates their effective permissions in the cluster. The escalate privilege allows a subject to modify cluster roles to which they are bound, increasing their rights to that level.

Each of these permissions has the potential to allow for privilege escalation to cluster-admin level.

## Impact

There are some cases where these permissions are required for cluster service operation, and care should be taken before removing these permissions from system service accounts.

## Audit

Review the users who have access to cluster roles or roles which provide the impersonate, bind, or escalate privileges.

## Remediation

Where possible, remove the impersonate, bind, and escalate rights from subjects.

## Default Value

In a default kubeadm cluster, the system:masters group and clusterrole-aggregation-controller service account have access to the escalate privilege. The system:masters group also has access to bind and impersonate.

## References

1. [https://raesene.github.io/blog/2020/12/12/Escalating_Away/](https://raesene.github.io/blog/2020/12/12/Escalating_Away/)
2. [https://raesene.github.io/blog/2021/01/16/Getting-Into-A-Bind-with-Kubernetes/](https://raesene.github.io/blog/2021/01/16/Getting-Into-A-Bind-with-Kubernetes/)

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control |      |      | x    |
