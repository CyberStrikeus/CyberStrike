---
name: cis-oke-v150-4.1.1
description: "Ensure that the cluster-admin role is only used where required (Automated)"
category: cis-oke
version: "1.5.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, rbac, service-accounts]
cis_id: "4.1.1"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.5.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.1 Ensure that the cluster-admin role is only used where required (Automated)

## Profile Applicability

- Level 1

## Description

The RBAC role `cluster-admin` provides wide-ranging powers over the environment and should be used only where and when needed.

## Rationale

Kubernetes provides a set of default roles where RBAC is used. Some of these roles such as `cluster-admin` provide wide-ranging privileges which should only be applied where absolutely necessary. Roles such as `cluster-admin` allow super-user access to perform any action on any resource. When used in a `ClusterRoleBinding`, it gives full control over every resource in the cluster and in all namespaces. When used in a `RoleBinding`, it gives full control over every resource in the rolebinding's namespace, including the namespace itself.

## Impact

Care should be taken before removing any `clusterrolebindings` from the environment to ensure they were not required for operation of the cluster. Specifically, modifications should not be made to `clusterrolebindings` with the `system:` prefix as they are required for the operation of system components.

## Audit Procedure

Obtain a list of the principals who have access to the `cluster-admin` role by reviewing the `clusterrolebinding` output for each role binding that has access to the `cluster-admin` role.

```bash
kubectl get clusterrolebindings -o=custom-columns=NAME:.metadata.name,ROLE:.roleRef.name,SUBJECT:.subjects[*].name
```

Review each principal listed and ensure that `cluster-admin` privilege is required for it.

## Remediation

Identify all clusterrolebindings to the cluster-admin role. Check if they are used and if they need this role or if they could use a role with fewer privileges. Where possible, first bind users to a lower privileged role and then remove the clusterrolebinding to the cluster-admin role:

```bash
kubectl delete clusterrolebinding [name]
```

## Default Value

By default a single `clusterrolebinding` called `cluster-admin` is provided with the `system:masters` group as its principal.

## References

1. [https://kubernetes.io/docs/admin/authorization/rbac/#user-facing-roles](https://kubernetes.io/docs/admin/authorization/rbac/#user-facing-roles)
2. [https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm](https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm)

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control |      |      | X    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1078, T1078.002            | TA0001, TA0004 | M1026       |

---

**Profile:** Level 1
