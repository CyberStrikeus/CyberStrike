---
name: cis-eks-v180-4.1.5
description: "Ensure that default service accounts are not actively used (Manual)"
category: cis-eks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, rbac, service-accounts, default-account, least-privilege]
cis_id: "4.1.5"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.8.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.5 Ensure that default service accounts are not actively used (Manual)

## Profile Applicability

- Level 1

## Description

The `default` service account should not be used to ensure that rights granted to applications can be more easily audited and reviewed.

## Rationale

Kubernetes provides a `default` service account which is used by cluster workloads where no specific service account is assigned to the pod.

Where access to the Kubernetes API from a pod is required, a specific service account should be created for that pod, and rights granted to that service account.

The default service account should be configured such that it does not provide a service account token and does not have any explicit rights assignments.

## Impact

All workloads which require access to the Kubernetes API will require an explicit service account to be created.

## Audit Procedure

For each namespace in the cluster, review the rights assigned to the default service account and ensure that it has no roles or cluster roles bound to it apart from the defaults.

Additionally ensure that the `automountServiceAccountToken: false` setting is in place for each default service account.

```bash
kubectl get serviceaccounts --all-namespaces -o yaml
```

## Remediation

Create explicit service accounts wherever a Kubernetes workload requires specific access to the Kubernetes API server. Modify the configuration of each default service account to include this value:

```yaml
automountServiceAccountToken: false
```

Automatic remediation for the default account:

```bash
kubectl patch serviceaccount default -p $'automountServiceAccountToken: false'
```

## Default Value

By default the `default` service account allows for its service account token to be mounted in pods in its namespace.

## References

1. https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/
2. https://aws.github.io/aws-eks-best-practices/iam/#disable-auto-mounting-of-service-account-tokens

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.3 Disable Dormant Accounts | x | x | x |
| v7 | 4.3 Ensure the Use of Dedicated Administrative Accounts | x | x | x |
| v7 | 16.9 Disable Dormant Accounts | x | x | x |
