---
name: cis-gke-v180-5.5.3
description: "Ensure Node Auto-Upgrade is Enabled for GKE Nodes (Automated)"
category: cis-gke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, node-configuration, container-optimized-os, auto-repair, auto-upgrade, release-channels, shielded-nodes]
cis_id: "5.5.3"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.8.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.5.3 Ensure Node Auto-Upgrade is Enabled for GKE Nodes (Automated)

## Profile Applicability

- Level 2

## Description

Node auto-upgrade keeps nodes at the current Kubernetes and OS security patch level to mitigate known vulnerabilities.

## Rationale

Node auto-upgrade helps you keep the nodes in the cluster or node pool up to date with the latest stable patch version of Kubernetes as well as the underlying node operating system. Node auto-upgrade uses the same update mechanism as manual node upgrades.

Node pools with node auto-upgrade enabled are automatically scheduled for upgrades when a new stable Kubernetes version becomes available. When the upgrade is performed, the Node pool is upgraded to match the current cluster master version. From a security perspective, this has the benefit of applying security updates automatically to the Kubernetes Engine when security fixes are released.

## Impact

Enabling node auto-upgrade does not cause the nodes to upgrade immediately. Automatic upgrades occur at regular intervals at the discretion of the Kubernetes Engine team.

To prevent upgrades occurring during a peak period for the cluster, a maintenance window should be defined. A maintenance window is a four-hour timeframe that can be chosen, during which automatic upgrades should occur. Upgrades can occur on any day of the week, and at any time within the timeframe. To prevent upgrades from occurring during certain dates, a maintenance exclusion should be defined. A maintenance exclusion can span multiple days.

Note: As part of the GKE node Auto-Upgrade process, the node is recreated. When a node is created, it automatically receives the latest version of the node image. For COS images, this is the primary OS upgrade mechanism.

## Audit

Using Google Cloud Console

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list
2. From the list of clusters, select the desired cluster. For each Node pool, view the Node pool Details pane and ensure that under the 'Management' heading, 'Auto-upgrade' is set to 'Enabled'.

Using Command Line
To check the existence of node auto-upgrade for an existing cluster's Node pool, first define 3 variables for Node Pool, Cluster Name and Zone, and then run the following command:

```
gcloud container node-pools describe $POOL_NAME --cluster $CLUSTER_NAME --zone $COMPUTE_ZONE --format json | jq '.management'
```

Ensure the output of the above command has JSON key attribute `autoUpgrade` set to `true`:

```json
{
  "autoUpgrade": true
}
```

If node auto-upgrade is disabled, the output of the above command output will not contain the `autoUpgrade` entry.

## Remediation

Using Google Cloud Console

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. Select the Kubernetes cluster containing the node pool for which auto-upgrade disabled.
3. Select the Node pool by clicking on the name of the pool.
4. Navigate to the Node pool details pane and click `EDIT`.
5. Under the Management heading, check the `Enable auto-repair` box.
6. Click `SAVE`.
7. Repeat steps 2-6 for every cluster and node pool with auto-upgrade disabled.

Using Command Line
To enable node auto-upgrade for an existing cluster's Node pool, run the following command:

```
gcloud container node-pools update <node_pool_name> --cluster <cluster_name> --zone <cluster_zone> --enable-autoupgrade
```

## Default Value

Node auto-upgrade is enabled by default.

Even if a cluster has been created with node auto-repair enabled, this only applies to the default Node pool. Subsequent node pools do not have node auto-upgrade enabled by default.

## References

1. https://cloud.google.com/kubernetes-engine/docs/concepts/node-auto-upgrades
2. https://cloud.google.com/kubernetes-engine/docs/how-to/maintenance-windows-and-exclusions
3. https://cloud.google.com/kubernetes-engine/docs/concepts/node-images
4. https://cloud.google.com/kubernetes-engine/docs/concepts/node-images

## Additional Information

Node auto-upgrades is not available for Alpha Clusters.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 7.3 Perform Automated Operating System Patch Management | x | x | x |
| v7 | 2.2 Ensure Software is Supported by Vendor | x | x | x |
| v7 | 3.4 Deploy Automated Operating System Patch Management Tools | x | x | x |
| v7 | 3.5 Deploy Automated Software Patch Management Tools | x | x | x |
