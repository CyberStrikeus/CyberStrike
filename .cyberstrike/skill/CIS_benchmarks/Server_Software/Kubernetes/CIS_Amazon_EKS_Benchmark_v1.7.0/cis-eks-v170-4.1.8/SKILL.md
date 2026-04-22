---
name: cis-eks-v170-4.1.8
description: "Limit use of the Bind, Impersonate and Escalate permissions in the Kubernetes cluster (Manual)"
category: cis-eks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, rbac, service-accounts, bind, impersonate, escalate, privilege-escalation]
cis_id: "4.1.8"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.7.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.8 Limit use of the Bind, Impersonate and Escalate permissions in the Kubernetes cluster (Manual)

## Profile Applicability

- Level 1

## Description

Cluster roles and roles with the impersonate, bind or escalate permissions should not be granted unless strictly required. Each of these permissions allow a particular subject to escalate their privileges beyond those explicitly granted by cluster administrators.

## Rationale

The impersonate privilege allows a subject to impersonate other users gaining their rights to the cluster. The bind privilege allows the subject to add a binding to a cluster role or role which escalates their effective permissions in the cluster. The escalate privilege allows a subject to modify cluster roles to which they are bound, increasing their rights to that level.

Each of these permissions has the potential to allow for privilege escalation to cluster-admin level.

## Impact

There are some cases where these permissions are required for cluster service operation, and care should be taken before removing these permissions from system service accounts.

## Audit Procedure

Review the users who have access to cluster roles or roles which provide the impersonate, bind or escalate privileges.

```bash
kubectl get clusterroles -o json | jq '.items[] | select(.rules[]? | .verbs[]? == "bind" or .verbs[]? == "impersonate" or .verbs[]? == "escalate") | .metadata.name'
kubectl get roles --all-namespaces -o json | jq '.items[] | select(.rules[]? | .verbs[]? == "bind" or .verbs[]? == "impersonate" or .verbs[]? == "escalate") | .metadata.name'
```

## Remediation

Where possible, remove the impersonate, bind and escalate rights from subjects.

## Default Value

In a default kubeadm cluster, the system:masters group and clusterrole-aggregation-controller service account have access to the escalate privilege. The system:masters group also has access to bind and impersonate.

## References

1. https://www.impidio.com/blog/kubernetes-rbac-security-pitfalls
2. https://raesene.github.io/blog/2020/12/12/Escalating_Away/
3. https://raesene.github.io/blog/2021/01/16/Getting-Into-A-Bind-with-Kubernetes/

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 14.7 Enforce Access Control to Data through Automated Tools                     |      |      | x    |
