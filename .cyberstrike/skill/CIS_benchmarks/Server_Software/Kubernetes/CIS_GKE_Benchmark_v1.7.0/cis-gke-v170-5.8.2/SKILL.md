---
name: cis-gke-v170-5.8.2
description: "Manage Kubernetes RBAC users with Google Groups for GKE (Manual)"
category: cis-gke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, authentication, rbac, google-groups, iam, access-control]
cis_id: "5.8.2"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.7.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.8.2 Manage Kubernetes RBAC users with Google Groups for GKE (Manual)

## Profile Applicability

- Level 2

## Description

Cluster Administrators should leverage G Suite Groups and Cloud IAM to assign Kubernetes user roles to a collection of users, instead of to individual emails using only Cloud IAM.

## Rationale

On- and off-boarding users is often difficult to automate and prone to error. Using a single source of truth for user permissions via G Suite Groups reduces the number of locations that an individual must be off-boarded from, and prevents users gaining unique permissions sets that increase the cost of audit.

## Impact

When migrating to using security groups, an audit of `RoleBindings` and `ClusterRoleBindings` is required to ensure all users of the cluster are managed using the new groups and not individually.

When managing `RoleBindings` and `ClusterRoleBindings`, be wary of inadvertently removing bindings required by service accounts.

## Audit

**Using G Suite Admin Console and Google Cloud Console:**

1. Navigate to manage G Suite Groups in the Google Admin console at: https://admin.google.com/dashboard
2. Ensure there is a group named `gke-security-groups@[yourdomain.com]`. The group must be named exactly `gke-security-groups`.
3. Ensure only further groups (not individual users) are included in the `gke-security-groups` group as members.
4. Go to the Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
5. From the list of clusters, click on the desired cluster. In the `Details` pane, make sure `Google Groups for RBAC` is set to `Enabled`.

## Remediation

Follow the G Suite Groups instructions at: https://cloud.google.com/kubernetes-engine/docs/how-to/role-based-access-control#google-groups-for-gke.

Then, create a cluster with:

```bash
gcloud container clusters create <cluster_name> --security-group <security_group_name>
```

Finally create `Roles`, `ClusterRoles`, `RoleBindings`, and `ClusterRoleBindings` that reference the G Suite Groups.

## Default Value

Google Groups for GKE is disabled by default.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/google-groups-rbac
2. https://cloud.google.com/kubernetes-engine/docs/how-to/role-based-access-control

## CIS Controls

| Controls Version | Control                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control  |      |      | x    |
| v7               | 16.2 Configure Centralized Point of Authentication |      | x    | x    |
