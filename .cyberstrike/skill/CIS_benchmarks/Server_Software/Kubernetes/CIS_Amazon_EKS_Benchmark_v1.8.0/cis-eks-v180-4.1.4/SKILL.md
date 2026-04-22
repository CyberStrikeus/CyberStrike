---
name: cis-eks-v180-4.1.4
description: "Minimize access to create pods (Manual)"
category: cis-eks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, rbac, service-accounts, pod-creation, privilege-escalation]
cis_id: "4.1.4"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.8.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.4 Minimize access to create pods (Manual)

## Profile Applicability

- Level 1

## Description

The ability to create pods in a namespace can provide a number of opportunities for privilege escalation, such as assigning privileged service accounts to these pods or mounting hostPaths with access to sensitive data (unless Pod Security Policies are implemented to restrict this access).

As such, access to create new pods should be restricted to the smallest possible group of users.

## Rationale

The ability to create pods in a cluster opens up possibilities for privilege escalation and should be restricted, where possible.

## Impact

Care should be taken not to remove access to pods to system components which require this for their operation.

## Audit Procedure

Review the users who have `create` access to pod objects in the Kubernetes API.

```bash
kubectl get clusterrolebindings -o=custom-columns=NAME:.metadata.name,ROLE:.roleRef.name,SUBJECT:.subjects[*].name
kubectl get rolebindings --all-namespaces -o=custom-columns=NAME:.metadata.name,ROLE:.roleRef.name,SUBJECT:.subjects[*].name
```

## Remediation

Where possible, remove `create` access to `pod` objects in the cluster.

## Default Value

By default, the following list of principals have `create` privileges on `pod` objects:

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

None specified.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 2.7 Allowlist Authorized Scripts | | | x |
| v7 | 4.7 Limit Access to Script Tools | | x | x |
