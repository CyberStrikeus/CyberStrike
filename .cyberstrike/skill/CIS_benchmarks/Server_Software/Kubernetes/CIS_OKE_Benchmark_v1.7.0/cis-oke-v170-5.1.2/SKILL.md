---
name: cis-oke-v170-5.1.2
description: "Minimize user access control to Container Engine for Kubernetes (Manual)"
category: cis-oke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, managed-services, image-registry, image-scanning]
cis_id: "5.1.2"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.7.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.7.0 - Control 5.1.2

## Profile Applicability
- **Level:** 1

## Description
Restrict user access to OKE, limiting interaction with build images to only authorized personnel and service accounts.

## Rationale
Weak access control to OKE may allow malicious users to replace built images with vulnerable or backdoored containers.

## Impact
Care should be taken not to remove access to Oracle Cloud Infrastructure Registry (OCR) for accounts that require this for their operation. Any account granted the Storage Object Viewer role at the project level can view all objects stored in OCS for the project.

## Audit Procedure
For most operations on Kubernetes clusters created and managed by Container Engine for Kubernetes, Oracle Cloud Infrastructure Identity and Access Management (IAM) provides access control. A user's permissions to access clusters comes from the groups to which they belong. The permissions for a group are defined by policies. Policies define what actions members of a group can perform, and in which compartments. Users can then access clusters and perform operations based on the policies set for the groups they are members of.

IAM provides control over:

- whether a user can create or delete clusters
- whether a user can add, remove, or modify node pools
- which Kubernetes object create/delete/view operations a user can perform on all clusters within a compartment or tenancy

See [Policy Configuration for Cluster Creation and Deployment](https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengpolicyconfig.htm).

In addition to IAM, the Kubernetes RBAC Authorizer can enforce additional fine-grained access control for users on specific clusters via Kubernetes RBAC roles and clusterroles. A Kubernetes RBAC role is a collection of permissions. For example, a role might include read permission on pods and list permission for pods. A Kubernetes RBAC clusterrole is just like a role, but can be used anywhere in the cluster. A Kubernetes RBAC rolebinding maps a role to a user or set of users, granting that role's permissions to those users for resources in that namespace. Similarly, a Kubernetes RBAC clusterrolebinding maps a clusterrole to a user or set of users, granting that clusterrole's permissions to those users across the entire cluster.

## Remediation
By default, users are not assigned any Kubernetes RBAC roles (or clusterroles) by default. So before attempting to create a new role (or clusterrole), you must be assigned an appropriately privileged role (or clusterrole). A number of such roles and clusterroles are always created by default, including the cluster-admin clusterrole (for a full list, see Default Roles and Role Bindings in the Kubernetes documentation). The cluster-admin clusterrole essentially confers super-user privileges. A user granted the cluster-admin clusterrole can perform any operation across all namespaces in a given cluster.

Note that Oracle Cloud Infrastructure tenancy administrators already have sufficient privileges, and do not require the cluster-admin clusterrole.

See: [Granting the Kubernetes RBAC cluster-admin clusterrole](https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengaboutaccesscontrol.htm)

## Default Value
Not applicable.

## References
1. https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengpolicyconfig.htm
2. https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengaboutaccesscontrol.htm

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | * |
| v7 | 14.6 Protect Information through Access Control Lists | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1078, T1078.002 | TA0001, TA0004 | M1026 |

## Profile
**Level 1** (Manual)
