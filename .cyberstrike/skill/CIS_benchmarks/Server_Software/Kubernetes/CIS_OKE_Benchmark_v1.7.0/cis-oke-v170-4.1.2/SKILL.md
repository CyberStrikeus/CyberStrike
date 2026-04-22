---
name: cis-oke-v170-4.1.2
description: "Minimize access to secrets (Automated)"
category: cis-oke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, rbac, service-accounts]
cis_id: "4.1.2"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.7.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.7.0 - Control 4.1.2

## Profile Applicability

- **Level:** 1

## Description

The Kubernetes API stores secrets, which may be service account tokens for the Kubernetes API or credentials used by workloads in the cluster. Access to these secrets should be restricted to the smallest possible group of users to reduce the risk of privilege escalation.

## Rationale

Inappropriate access to secrets stored within the Kubernetes cluster can allow for an attacker to gain additional access to the Kubernetes cluster or external resources whose credentials are stored as secrets.

## Impact

Care should be taken not to remove access to secrets to system components which require this for their operation.

## Audit Procedure

Review the users who have `get`, `list` or `watch` access to `secrets` objects in the Kubernetes API. Run the following command to list all the users who have access to secrets objects in the Kubernetes API:

```bash
kubectl auth can-i get,list,watch secrets --all-namespaces --as=system:authenticated
```

This command checks if the system:authenticated group (which includes all authenticated users) has the get, list, or watch permissions for secrets objects in all namespaces. The output will display either yes or no for each user.

Note: If you want to check for specific namespaces, replace --all-namespaces with the desired namespace(s) separated by commas.

## Remediation

Where possible, remove `get`, `list` and `watch` access to `secret` objects in the cluster.

## Default Value

By default, the following list of principals have `get` privileges on `secret` objects:

```
CLUSTERROLEBINDING                                        SUBJECT
TYPE              SA-NAMESPACE
cluster-admin                                             system:masters
Group
system:controller:clusterrole-aggregation-controller      clusterrole-
aggregation-controller  ServiceAccount  kube-system
system:controller:expand-controller                       expand-controller
ServiceAccount    kube-system
system:controller:generic-garbage-collector               generic-garbage-
collector              ServiceAccount  kube-system
system:controller:namespace-controller                    namespace-controller
ServiceAccount    kube-system
system:controller:persistent-volume-binder                persistent-volume-
binder                 ServiceAccount  kube-system
system:kube-controller-manager                            system:kube-controller-
manager         User
```

## References

1. https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm

## CIS Controls

| Controls Version | Control                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.1 Establish and Maintain a Secure Configuration Process | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1552                       | TA0006  | M1026       |

## Profile

**Level 1** (Automated)
