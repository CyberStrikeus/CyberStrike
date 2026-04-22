---
name: cis-gke-v170-5.5.2
description: "Ensure Node Auto-Repair is enabled for GKE nodes (Automated)"
category: cis-gke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, node-config, auto-repair, node-maintenance, availability]
cis_id: "5.5.2"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.7.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.5.2 Ensure Node Auto-Repair is enabled for GKE nodes (Automated)

## Profile Applicability

- Level 2

## Description

Nodes in a degraded state are an unknown quantity and so may pose a security risk.

## Rationale

Kubernetes Engine's node auto-repair feature helps you keep the nodes in the cluster in a healthy, running state. When enabled, Kubernetes Engine makes periodic checks on the health state of each node in the cluster. If a node fails consecutive health checks over an extended time period, Kubernetes Engine initiates a repair process for that node.

## Impact

If multiple nodes require repair, Kubernetes Engine might repair them in parallel. Kubernetes Engine limits number of repairs depending on the size of the cluster (bigger clusters have a higher limit) and the number of broken nodes in the cluster (limit decreases if many nodes are broken).

Node auto-repair is not available on Alpha Clusters.

## Audit

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list
2. From the list of clusters, select the desired cluster. For each Node pool, view the Node pool Details pane and ensure that under the 'Management' heading, 'Auto-repair' is set to 'Enabled'.

**Using Command Line:**

To check the existence of node auto-repair for an existing cluster's node pool, run:

```bash
gcloud container node-pools describe <node_pool_name> --cluster <cluster_name> --zone <compute_zone> --format json | jq '.management'
```

Ensure the output of the above command has JSON key attribute `autoRepair` set to `true`:

```json
{
  "autoRepair": true
}
```

## Remediation

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list
2. Select the Kubernetes cluster containing the node pool for which auto-repair is disabled.
3. Select the Node pool by clicking on the name of the pool.
4. Navigate to the Node pool details pane and click `EDIT`.
5. Under the `Management` heading, check the `Enable auto-repair` box.
6. Click `SAVE`.
7. Repeat steps 2-6 for every cluster and node pool with auto-upgrade disabled.

**Using Command Line:**

To enable node auto-repair for an existing cluster's Node pool:

```bash
gcloud container node-pools update <node_pool_name> --cluster <cluster_name> --zone <compute_zone> --enable-autorepair
```

## Default Value

Node auto-repair is enabled by default.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/node-auto-repair

## CIS Controls

| Controls Version | Control                                                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 7.6 Perform Automated Vulnerability Scans of Externally-Exposed Enterprise Assets |      | x    | x    |
| v7               | 3.1 Run Automated Vulnerability Scanning Tools                                    |      | x    | x    |
