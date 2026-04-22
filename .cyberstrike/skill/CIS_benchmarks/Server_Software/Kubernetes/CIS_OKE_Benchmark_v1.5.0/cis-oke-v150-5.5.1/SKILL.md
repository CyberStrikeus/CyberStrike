---
name: cis-oke-v150-5.5.1
description: "Manage Kubernetes RBAC users with Oracle Cloud Infrastructure Identity and Access Management (IAM) (Manual)"
category: cis-oke
version: "1.5.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, managed-services, authentication, authorization, iam]
cis_id: "5.5.1"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.5.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.5.1 Manage Kubernetes RBAC users with Oracle Cloud Infrastructure Identity and Access Management (IAM) (Manual)

## Profile Applicability

- Level 1

## Description

Cluster Administrators should leverage Oracle Groups and Cloud IAM to assign Kubernetes user roles to a collection of users, instead of to individual emails using only Cloud IAM.

## Rationale

For most operations on Kubernetes clusters created and managed by Container Engine for Kubernetes, Oracle Cloud Infrastructure Identity and Access Management (IAM) provides access control. A user's permissions to access clusters comes from the groups to which they belong. The permissions for a group are defined by policies. Policies define what actions members of a group can perform, and in which compartments. Users can then access clusters and perform operations based on the policies set for the groups they are members of.

IAM provides control over:

- whether a user can create or delete clusters
- whether a user can add, remove, or modify node pools
- which Kubernetes object create/delete/view operations a user can perform on all clusters within a compartment or tenancy

See [Policy Configuration for Cluster Creation and Deployment](https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengpolicyconfig.htm).

## Impact

Users must now be assigned to the IAM group created to use this namespace and deploy applications. If they are not they will not be able to access the namespace or deploy.

## Audit

By default, users are not assigned any Kubernetes RBAC roles (or clusterroles) by default. So before attempting to create a new role (or clusterrole), you must be assigned an appropriately privileged role (or clusterrole). A number of such roles and clusterroles are always created by default, including the cluster-admin clusterrole (for a full list, see Default Roles and Role Bindings in the Kubernetes documentation). The cluster-admin clusterrole essentially confers super-user privileges. A user granted the cluster-admin clusterrole can perform any operation across all namespaces in a given cluster.

## Remediation

Example: Granting the Kubernetes RBAC cluster-admin clusterrole

Follow these steps to grant a user who is not a tenancy administrator the Kubernetes RBAC cluster-admin clusterrole on a cluster deployed on Oracle Cloud Infrastructure:

1. If you haven't already done so, follow the steps to set up the cluster's kubeconfig configuration file and (if necessary) set the KUBECONFIG environment variable to point to the file. Note that you must set up your own kubeconfig file. You cannot access a cluster using a kubeconfig file that a different user set up. See [Setting Up Cluster Access](https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Tasks/contengdownloadkubeconfigfile.htm).

2. In a terminal window, grant the Kubernetes RBAC cluster-admin clusterrole to the user by entering:

```bash
kubectl create clusterrolebinding <my-cluster-admin-binding> --clusterrole=cluster-admin --user=<user_OCID>
```

where:

- `<my-cluster-admin-binding>` is a string of your choice to be used as the name for the binding between the user and the Kubernetes RBAC cluster-admin clusterrole. For example, jdoe_clst_adm
- `<user_OCID>` is the user's OCID (obtained from the Console). For example, ocid1.user.oc1..aaaaa...zutq (abbreviated for readability).

For example:

```bash
kubectl create clusterrolebinding jdoe_clst_adm --clusterrole=cluster-admin --user=ocid1.user.oc1..aaaaa...zutq
```

## Default Value

By default, users are not assigned any Kubernetes RBAC roles (or clusterroles).

## References

1. [https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengaboutaccesscontrol.htm](https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengaboutaccesscontrol.htm)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 12.5 Centralize Network Authentication, Authorization, and Auditing (AAA) - Centralize network AAA. | | x | x |
| v7 | 16.2 Configure Centralized Point of Authentication - Configure access for all accounts through as few centralized points of authentication as possible, including network, security, and cloud systems. | | x | x |

## Profile

Level 1 - OKE
