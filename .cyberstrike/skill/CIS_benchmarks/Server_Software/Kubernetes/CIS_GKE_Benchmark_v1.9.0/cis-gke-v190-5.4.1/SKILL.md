---
name: cis-gke-v190-5.4.1
description: "Ensure the GKE Metadata Server is Enabled (Automated)"
category: cis-gke
version: "1.9.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, metadata, workload-identity, node-metadata]
cis_id: "5.4.1"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.9.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.1 Ensure the GKE Metadata Server is Enabled (Automated)

## Profile Applicability

- Level 2

## Description

Running the GKE Metadata Server prevents workloads from accessing sensitive instance metadata and facilitates Workload Identity.

## Rationale

Every node stores its metadata on a metadata server. Some of this metadata, such as kubelet credentials and the VM instance identity token, is sensitive and should not be exposed to a Kubernetes workload. Enabling the GKE Metadata server prevents pods (that are not running on the host network) from accessing this metadata and facilitates Workload Identity.

When unspecified, the default setting allows running pods to have full access to the node's underlying metadata server.

## Impact

The GKE Metadata Server must be run when using Workload Identity. Because Workload Identity replaces the need to use Metadata Concealment, the two approaches are incompatible.

When the GKE Metadata Server and Workload Identity are enabled, unless the Pod is running on the host network, Pods cannot use the Compute Engine default service account.

Workloads may need modification in order for them to use Workload Identity as described within: https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity.

## Audit

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting https://console.cloud.google.com/kubernetes/list
2. From the list of clusters, click on the name of the cluster of interest and for each Node pool within the cluster, open the `Details` pane, and ensure that the GKE Metadata Server is set to `Enabled`.

**Using Command Line:**

To check whether the GKE Metadata Server is enabled for each Node pool within a cluster, run the following command:

```bash
gcloud container clusters describe <cluster_name> --zone <cluster_zone> --format json | jq .nodePools[].config.workloadMetadataConfig
```

This should return the following for each Node pool:

```json
{
  "mode": "GKE_METADATA"
}
```

Null (`{ }`) is returned if the GKE Metadata Server is not enabled.

## Remediation

The GKE Metadata Server requires Workload Identity to be enabled on a cluster. Modify the cluster to enable Workload Identity and enable the GKE Metadata Server.

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting https://console.cloud.google.com/kubernetes/list
2. From the list of clusters, select the cluster for which Workload Identity is disabled.
3. Under the `DETAILS` pane, navigate down to the `Security` subsection.
4. Click on the pencil icon named `Edit Workload Identity`, click on `Enable Workload Identity` in the pop-up window, and select a workload pool from the drop-down box. By default, it will be the namespace of the Cloud project containing the cluster, for example: `<project_id>.svc.id.goog`.
5. Click `SAVE CHANGES` and wait for the cluster to update.
6. Once the cluster has updated, select each Node pool within the cluster Details page.
7. For each Node pool, select `EDIT` within the Node pool details page.
8. Within the `Edit node pool` pane, check the `Enable GKE Metadata Server` checkbox.
9. Click `SAVE`.

**Using Command Line:**

```bash
gcloud container clusters update <cluster_name> --identity-namespace=<project_id>.svc.id.goog
```

Note that existing Node pools are unaffected. New Node pools default to `--workload-metadata-from-node=GKE_METADATA_SERVER`.

To modify an existing Node pool to enable GKE Metadata Server:

```bash
gcloud container node-pools update <node_pool_name> --cluster=<cluster_name> --workload-metadata-from-node=GKE_METADATA_SERVER
```

Workloads may need modification in order for them to use Workload Identity as described within: https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity.

## Default Value

By default, running pods to have full access to the node's underlying metadata server.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/protecting-cluster-metadata#concealment
2. https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity
3. https://cloud.google.com/kubernetes-engine/docs/concepts/workload-identity

## CIS Controls

| Controls Version | Control                                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure |      | x    | x    |
| v7               | 5.2 Maintain Secure Images                                                         |      | x    | x    |
