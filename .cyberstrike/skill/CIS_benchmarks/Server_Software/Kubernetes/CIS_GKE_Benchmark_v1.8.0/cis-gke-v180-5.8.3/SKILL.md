---
name: cis-gke-v180-5.8.3
description: "Ensure Legacy Authorization (ABAC) is Disabled (Automated)"
category: cis-gke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, authentication, authorization, client-certificates, rbac, abac, google-groups]
cis_id: "5.8.3"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.8.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.8.3 Ensure Legacy Authorization (ABAC) is Disabled (Automated)

## Profile Applicability

- Level 1

## Description

Legacy Authorization, also known as Attribute-Based Access Control (ABAC) has been superseded by Role-Based Access Control (RBAC) and is not under active development. RBAC is the recommended way to manage permissions in Kubernetes.

## Rationale

In Kubernetes, RBAC is used to grant permissions to resources at the cluster and namespace level. RBAC allows the definition of roles with rules containing a set of permissions, whilst the legacy authorizer (ABAC) in Kubernetes Engine grants broad, statically defined permissions. As RBAC provides significant security advantages over ABAC, it is recommended option for access control. Where possible, legacy authorization must be disabled for GKE clusters.

## Impact

Once the cluster has the legacy authorizer disabled, the user must be granted the ability to create authorization roles using RBAC to ensure that the role-based access control permissions take effect.

## Audit

Using Google Cloud Console:

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. From the list of clusters, click on each cluster to open the Details pane, and make sure 'Legacy Authorization' is set to 'Disabled'.

Using Command Line:
To check Legacy Authorization status for an existing cluster, first define 2 variables for Cluster Name and Zone and then run the following command:

```
gcloud container clusters describe $CLUSTER_NAME --zone $COMPUTE_ZONE --format json | jq '.legacyAbac'
```

The output should return null

```
null
```

if Legacy Authorization is Disabled. If Legacy Authorization is Enabled, the above command will return `true` value.

## Remediation

Using Google Cloud Console:

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. Select Kubernetes clusters for which Legacy Authorization is enabled.
3. Click EDIT.
4. Set 'Legacy Authorization' to 'Disabled'.
5. Click SAVE.

Using Command Line:
To disable Legacy Authorization for an existing cluster, run the following command:

```
gcloud container clusters update <cluster_name> --zone <compute_zone> --no-enable-legacy-authorization
```

## Default Value

Kubernetes Engine clusters running GKE version 1.8 and later disable the legacy authorization system by default, and thus role-based access control permissions take effect with no special action required.

## Additional Information

On clusters running GKE 1.6 or 1.7, Kubernetes Service accounts have full permissions on the Kubernetes API by default. To ensure that the role-based access control permissions take effect for a Kubernetes service account, the cluster must be created or updated with the option `--no-enable-legacy-authorization`. This requirement is removed for clusters running GKE version 1.8 or higher.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/role-based-access-control
2. https://cloud.google.com/kubernetes-engine/docs/how-to/hardening-your-cluster#leave_abac_disabled_default_for_110

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control |      |      | x    |
| v7               | 4 Controlled Use of Administrative Privileges     |      |      |      |
| v7               | 16 Account Monitoring and Control                 |      |      |      |
