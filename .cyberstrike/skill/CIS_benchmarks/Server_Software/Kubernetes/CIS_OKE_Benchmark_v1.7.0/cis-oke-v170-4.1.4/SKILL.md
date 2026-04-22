---
name: cis-oke-v170-4.1.4
description: "Minimize access to create pods (Automated)"
category: cis-oke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, rbac, service-accounts]
cis_id: "4.1.4"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.7.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.7.0 - Control 4.1.4

## Profile Applicability
- **Level:** 1

## Description
The ability to create pods in a namespace can provide a number of opportunities for privilege escalation, such as assigning privileged service accounts to these pods or mounting hostPaths with access to sensitive data (unless Pod Security Policies are implemented to restrict this access).

As such, access to create new pods should be restricted to the smallest possible group of users.

## Rationale
The ability to create pods in a cluster opens up possibilities for privilege escalation and should be restricted, where possible.

## Impact
Care should be taken not to remove access to pods to system components which require this for their operation.

## Audit Procedure
Review the users who have create access to pod objects in the Kubernetes API. Run the following command to list all the users who have access to create pod objects in the Kubernetes API:

```bash
kubectl auth can-i create pods --all-namespaces --as=system:authenticated
```

This command checks if the system:authenticated group (which includes all authenticated users) has the create permission for pod objects in all namespaces. The output will display either yes or no for each user.

Note: If you want to check for specific namespaces, replace --all-namespaces with the desired namespace(s) separated by commas.

## Remediation
Where possible, remove `create` access to `pod` objects in the cluster.

## Default Value
By default, the following list of principals have `create` privileges on `pod` objects:

```
CLUSTERROLEBINDING                                        SUBJECT
TYPE              SA-NAMESPACE
cluster-admin                                             system:masters
Group
system:controller:clusterrole-aggregation-controller      clusterrole-
aggregation-controller  ServiceAccount  kube-system
system:controller:daemon-set-controller                   daemon-set-controller
ServiceAccount    kube-system
system:controller:job-controller                          job-controller
ServiceAccount    kube-system
system:controller:persistent-volume-binder                persistent-volume-
binder                 ServiceAccount  kube-system
system:controller:replicaset-controller                   replicaset-controller
ServiceAccount    kube-system
system:controller:replication-controller                  replication-controller
ServiceAccount    kube-system
system:controller:statefulset-controller                  statefulset-controller
ServiceAccount    kube-system
```

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | * |
| v7 | 5.1 Establish Secure Configurations | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1078, T1078.002 | TA0001, TA0004 | M1026 |

## Profile
**Level 1** (Automated)
