---
name: cis-gke-v170-5.6.1
description: "Enable VPC Flow Logs and Intranode Visibility (Automated)"
category: cis-gke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, networking, vpc, flow-logs, intranode-visibility, traffic-monitoring]
cis_id: "5.6.1"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.7.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.6.1 Enable VPC Flow Logs and Intranode Visibility (Automated)

## Profile Applicability

- Level 2

## Description

Enable VPC Flow Logs and Intranode Visibility to see pod-level traffic, even for traffic within a worker node.

## Rationale

Enabling Intranode Visibility makes intranode pod to pod traffic visible to the networking fabric. With this feature, VPC Flow Logs or other VPC features can be used for intranode traffic.

## Impact

Enabling it on existing cluster causes the cluster master and the cluster nodes to restart, which might cause disruption.

## Audit

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list
2. Select the desired cluster, and under the `Cluster` section, make sure that `Intranode visibility` is set to `Enabled`.

**Using Command Line:**

Run this command:

```bash
gcloud container clusters describe <cluster_name> --zone <compute_zone> --format json | jq '.networkConfig.enableIntraNodeVisibility'
```

The result should return `true` if Intranode Visibility is Enabled.

## Remediation

**Enable Intranode Visibility:**

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. Select Kubernetes clusters for which intranode visibility is disabled.
3. Within the `Details` pane, under the `Network` section, click on the pencil icon named `Edit intranode visibility`.
4. Check the box next to `Enable Intranode visibility`.
5. Click `SAVE CHANGES`.

**Using Command Line:**

To enable intranode visibility on an existing cluster, run the following command:

```bash
gcloud container clusters update <cluster_name> --enable-intra-node-visibility
```

**Enable VPC Flow Logs:**

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. Select Kubernetes clusters for which VPC Flow Logs are disabled.
3. Select `Nodes` tab.
4. Select Node Pool without VPC Flow Logs enabled.
5. Select an Instance Group within the node pool.
6. Select an `Instance Group Member`.
7. Select the `Subnetwork` under Network Interfaces.
8. Click on `EDIT`.
9. Set Flow logs to `On`.
10. Click `SAVE`.

**Using Command Line:**

1. Find the subnetwork name associated with the cluster.

```bash
gcloud container clusters describe <cluster_name> --region <cluster_region> --format json | jq '.subnetwork'
```

2. Update the subnetwork to enable VPC Flow Logs.

```bash
gcloud compute networks subnets update <subnet_name> --enable-flow-logs
```

## Default Value

By default, Intranode Visibility is disabled.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/intranode-visibility
2. https://cloud.google.com/vpc/docs/using-flow-logs

## CIS Controls

| Controls Version | Control                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs |      | x    | x    |
| v7               | 6.3 Enable Detailed Logging     |      | x    | x    |
