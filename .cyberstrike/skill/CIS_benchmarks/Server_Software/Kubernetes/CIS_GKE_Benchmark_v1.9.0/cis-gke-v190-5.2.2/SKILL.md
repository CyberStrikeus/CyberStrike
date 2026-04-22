---
name: cis-gke-v190-5.2.2
description: "Prefer using dedicated GCP Service Accounts and Workload Identity (Manual)"
category: cis-gke
version: "1.9.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, iam, service-account, workload-identity]
cis_id: "5.2.2"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.9.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.2 Prefer using dedicated GCP Service Accounts and Workload Identity (Manual)

## Profile Applicability

- Level 2

## Description

Kubernetes workloads should not use cluster node service accounts to authenticate to Google Cloud APIs. Each Kubernetes Workload that needs to authenticate to other Google services using Cloud IAM should be provisioned a dedicated Service account. Enabling Workload Identity manages the distribution and rotation of Service account keys for the workloads to use.

## Rationale

Manual approaches for authenticating Kubernetes workloads running on GKE against Google Cloud APIs are: storing service account keys as a Kubernetes secret (which introduces manual key rotation and potential for key compromise); or use of the underlying nodes' IAM Service account, which violates the principle of least privilege on a multitenanted node, when one pod needs to have access to a service, but every other pod on the node that uses the Service account does not.

Once a relationship between a Kubernetes Service account and a GCP Service account has been configured, any workload running as the Kubernetes Service account automatically authenticates as the mapped GCP Service account when accessing Google Cloud APIs on a cluster with Workload Identity enabled.

## Impact

Workload Identity replaces the need to use Metadata Concealment and as such, the two approaches are incompatible. The sensitive metadata protected by Metadata Concealment is also protected by Workload Identity.

When Workload Identity is enabled, the Compute Engine default Service account can not be used. Correspondingly, Workload Identity can't be used with Pods running in the host network. Workloads may also need to be modified in order for them to use Workload Identity, as described within: https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity

GKE infrastructure pods such as Stackdriver will continue to use the Node's Service account.

## Audit

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting https://console.cloud.google.com/kubernetes/list
2. From the list of clusters, click on each cluster to bring up the Details pane, make sure for each cluster Workload Identity is set to 'Enabled' under the 'Cluster' section and ensure that the Workload Identity Namespace is set to the namespace of the GCP project containing the cluster, for example: `<project_id>.svc.id.goog`
3. Additionally, click on each Node pool within each cluster to observe the Node pool Details pane, and ensure that the GKE Metadata Server is 'Enabled'.

**Using Command Line:**

```bash
gcloud container clusters describe <cluster_name> --zone <cluster_zone>
```

If Workload Identity is enabled, the following fields should be present, and the `<project_id>` should be set to the namespace of the GCP project containing the cluster:

```
workloadIdentityConfig:
  identityNamespace:<project_id>.svc.id.goog
```

For each Node pool, ensure the following is set:

```
workloadMetadataConfig:
    nodeMetadata: GKE_METADATA_SERVER
```

Each Kubernetes workload requiring Google Cloud API access will need to be manually audited to ensure that Workload Identity is being used and not some other method.

## Remediation

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. From the list of clusters, select the cluster for which Workload Identity is disabled.
3. Within the `Details` pane, under the `Security` section, click on the pencil icon named `Edit workload identity`.
4. Enable Workload Identity and set the workload pool to the namespace of the Cloud project containing the cluster, for example: `<project_id>.svc.id.goog`.
5. Click `SAVE CHANGES` and wait for the cluster to update.
6. Once the cluster has updated, select each Node pool within the cluster Details page.
7. For each Node pool, select `EDIT` within the Node pool Details page
8. Within the Edit node pool pane, check the 'Enable GKE Metadata Server' checkbox and click `SAVE`.

**Using Command Line:**

```bash
gcloud container clusters update <cluster_name> --zone <cluster_zone> --workload-pool <project_id>.svc.id.goog
```

Note that existing Node pools are unaffected. New Node pools default to `--workload-metadata-from-node=GKE_METADATA_SERVER`.
Then, modify existing Node pools to enable `GKE_METADATA_SERVER`:

```bash
gcloud container node-pools update <node_pool_name> --cluster <cluster_name> --zone <cluster_zone> --workload-metadata=GKE_METADATA
```

Workloads may need to be modified in order for them to use Workload Identity as described within: https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity. Also consider the effects on the availability of hosted workloads as Node pools are updated. It may be more appropriate to create new Node Pools.

## Default Value

By default, Workload Identity is disabled.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity
2. https://cloud.google.com/kubernetes-engine/docs/concepts/cluster-architecture
3. https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity

## CIS Controls

| Controls Version | Control                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.7 Manage Default Accounts on Enterprise Assets and Software | x    | x    | x    |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts       | x    | x    | x    |
