---
name: cis-gke-v190-5.5.6
description: "Ensure Integrity Monitoring for Shielded GKE Nodes is Enabled (Automated)"
category: cis-gke
version: "1.9.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, node-config, shielded-nodes, integrity-monitoring, boot-integrity]
cis_id: "5.5.6"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.9.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.5.6 Ensure Integrity Monitoring for Shielded GKE Nodes is Enabled (Automated)

## Profile Applicability

- Level 1

## Description

Enable Integrity Monitoring for Shielded GKE Nodes to be notified of inconsistencies during the node boot sequence.

## Rationale

Integrity Monitoring provides active alerting for Shielded GKE nodes which allows administrators to respond to integrity failures and prevent compromised nodes from being deployed into the cluster.

## Impact

None.

## Audit

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list
2. From the list of clusters, click on the name of the cluster under test.
3. Open the Details pane for each Node pool within the cluster, and ensure that 'Integrity monitoring' is set to 'Enabled' under the Security heading.

**Using Command Line:**

To check if Integrity Monitoring is enabled for the Node pools in the cluster, run the following command for each Node pool:

```bash
gcloud container node-pools describe <node_pool_name> --cluster <cluster_name> --zone <compute_zone> --format json | jq .config.shieldedInstanceConfig
```

This will return the following, if Integrity Monitoring is enabled:

```json
{
  "enableIntegrityMonitoring": true
}
```

## Remediation

Once a Node pool is provisioned, it cannot be updated to enable Integrity Monitoring. New Node pools must be created within the cluster with Integrity Monitoring enabled.

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list
2. From the list of clusters, click on the cluster requiring the update and click `ADD NODE POOL`.
3. Ensure that the 'Integrity monitoring' checkbox is checked under the 'Shielded options' Heading.
4. Click `SAVE`.

Workloads from existing non-conforming Node pools will need to be migrated to the newly created Node pool, then delete non-conforming Node pools to complete the remediation.

**Using Command Line:**

To create a Node pool within the cluster with Integrity Monitoring enabled, run the following command:

```bash
gcloud container node-pools create <node_pool_name> --cluster <cluster_name> --zone <compute_zone> --shielded-integrity-monitoring
```

Workloads from existing non-conforming Node pools will need to be migrated to the newly created Node pool, then delete non-conforming Node pools to complete the remediation.

## Default Value

Integrity Monitoring is disabled by default on GKE clusters. Integrity Monitoring is enabled by default for Shielded GKE Nodes; however, if Secure Boot is enabled at creation time, Integrity Monitoring is disabled.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/shielded-gke-nodes
2. https://cloud.google.com/compute/shielded-vm/docs/integrity-monitoring

## CIS Controls

| Controls Version | Control                                                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 7.5 Perform Automated Vulnerability Scans of Internal Enterprise Assets           |      | x    | x    |
| v8               | 7.6 Perform Automated Vulnerability Scans of Externally-Exposed Enterprise Assets |      | x    | x    |
| v7               | 5.3 Securely Store Master Images                                                  |      | x    | x    |
