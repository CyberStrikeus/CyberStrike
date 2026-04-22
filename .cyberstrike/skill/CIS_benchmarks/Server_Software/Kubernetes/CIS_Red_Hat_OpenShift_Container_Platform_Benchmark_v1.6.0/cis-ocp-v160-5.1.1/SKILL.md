---
name: cis-ocp-v160-5.1.1
description: "Ensure that the cluster-admin role is only used where required (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, rbac, service-accounts]
cis_id: "5.1.1"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 5.1.1

## Profile Applicability
- **Level:** 1

## Description
The RBAC role `cluster-admin` provides wide-ranging powers over the environment and should be used only where and when needed.

## Rationale
Kubernetes provides a set of default roles where RBAC is used. Some of these roles such as `cluster-admin` provide wide-ranging privileges which should only be applied where absolutely necessary. Roles such as `cluster-admin` allow super-user access to perform any action on any resource. When used in a `ClusterRoleBinding`, it gives full control over every resource in the cluster and in all namespaces. When used in a `RoleBinding`, it gives full control over every resource in the rolebinding's namespace, including the namespace itself.

## Impact
Care should be taken before removing any `clusterrolebindings` from the environment to ensure they were not required for operation of the cluster. Specifically, modifications should not be made to `clusterrolebindings` with the `system:` prefix as they are required for the operation of system components.

## Audit Procedure
OpenShift provides a set of default cluster roles that you can bind to users and groups cluster-wide or locally (per project namespace). Be mindful of the difference between local and cluster bindings. For example, if you bind the cluster-admin role to a user by using a local role binding, it might appear that this user has the privileges of a cluster administrator. This is not the case. Binding the cluster-admin to a user in a project grants super administrator privileges for only that project to the user. You can use the oc CLI to view cluster roles and bindings by using the oc describe command. For more information, see Default Cluster Roles.

Some of these roles such as cluster-admin provide wide-ranging privileges which should only be applied where absolutely necessary. Roles such as cluster-admin allow super-user access to perform any action on any resource. When used in a ClusterRoleBinding, it gives full control over every resource in the cluster and in all namespaces. When used in a RoleBinding, it gives full control over every resource in the rolebinding's namespace, including the namespace itself.

Review users and groups bound to cluster-admin and decide whether they require such access. Consider creating least-privilege roles for users and service accounts.

Obtain a list of the principals who have access to the cluster-admin role by reviewing the `clusterrolebinding` output for each role binding that has access to the cluster-admin role.

```bash
# needs verification

# To get a list of users and service accounts with the cluster-admin role
oc get clusterrolebindings -o=custom-columns=NAME:.metadata.name,ROLE:.roleRef.name,SUBJECT:.subjects[*].kind | grep cluster-admin

# To verify that kubeadmin is removed, no results should be returned
oc get secrets kubeadmin -n kube-system
```

Review each principal listed and ensure that cluster-admin privilege is required for it.
Verify that the kubeadmin user no longer exists.

## Remediation
Identify all `clusterrolebindings` to the cluster-admin role. Check if they are used and if they need this role or if they could use a role with fewer privileges.
Where possible, first bind users to a lower privileged role and then remove the `clusterrolebinding` to the cluster-admin role:

```bash
oc delete clusterrolebinding [name]
```

## Default Value
By default a single `clusterrolebinding` called `cluster-admin` is provided with the `system:masters` group as its principal.

The principal for cluster-admin also includes system:cluster-admins (Group) and system:admin (User).

## References
1. https://kubernetes.io/docs/reference/access-authn-authz/rbac/#user-facing-roles

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | * | * | * |
| v7 | 4.3 Ensure the Use of Dedicated Administrative Accounts | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1078, T1078.002 | TA0001, TA0004 | M1026 |

## Profile
**Level 1** (Manual)
