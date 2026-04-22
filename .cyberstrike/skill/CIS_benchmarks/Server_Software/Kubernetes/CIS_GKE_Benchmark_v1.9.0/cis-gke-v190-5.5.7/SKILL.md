---
name: cis-gke-v190-5.5.7
description: "Ensure Secure Boot for Shielded GKE Nodes is Enabled (Automated)"
category: cis-gke
version: "1.9.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, node-config, shielded-nodes, secure-boot, boot-integrity]
cis_id: "5.5.7"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.9.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.5.7 Ensure Secure Boot for Shielded GKE Nodes is Enabled (Automated)

## Profile Applicability

- Level 2

## Description

Enable Secure Boot for Shielded GKE Nodes to verify the digital signature of node boot components.

## Rationale

An attacker may seek to alter boot components to persist malware or root kits during system initialisation. Secure Boot helps ensure that the system only runs authentic software by verifying the digital signature of all boot components, and halting the boot process if signature verification fails.

## Impact

Secure Boot will not permit the use of third-party unsigned kernel modules.

## Audit

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. From the list of clusters, click on the name of the cluster under test.
3. Open the Details pane for each Node pool within the cluster, and ensure that `Secure boot` is set to `Enabled` under the Security heading.

**Using Command Line:**

To check if Secure Boot is enabled for the Node pools in the cluster, run the following command for each Node pool:

```bash
gcloud container node-pools describe <node_pool_name> --cluster <cluster_name> --zone <compute_zone> --format json | jq .config.shieldedInstanceConfig
```

This will return the value below, if Secure Boot is enabled:

```json
{
  "enableSecureBoot": true
}
```

## Remediation

Once a Node pool is provisioned, it cannot be updated to enable Secure Boot. New Node pools must be created within the cluster with Secure Boot enabled.

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list
2. From the list of clusters, click on the cluster requiring the update and click `ADD NODE POOL`.
3. Ensure that the `Secure boot` checkbox is checked under the `Shielded options` Heading.
4. Click `SAVE`.

Workloads will need to be migrated from existing non-conforming Node pools to the newly created Node pool, then delete the non-conforming pools.

**Using Command Line:**

To create a Node pool within the cluster with Secure Boot enabled, run the following command:

```bash
gcloud container node-pools create <node_pool_name> --cluster <cluster_name> --zone <compute_zone> --shielded-secure-boot
```

Workloads will need to be migrated from existing non-conforming Node pools to the newly created Node pool, then delete the non-conforming pools.

## Default Value

By default, Secure Boot is disabled in GKE clusters. By default, Secure Boot is disabled when Shielded GKE Nodes is enabled.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/shielded-gke-nodes#secure_boot
2. https://cloud.google.com/kubernetes-engine/docs/how-to/hardening-your-cluster

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 7.5 Perform Automated Vulnerability Scans of Internal Enterprise Assets | | x | x |
| v8 | 7.6 Perform Automated Vulnerability Scans of Externally-Exposed Enterprise Assets | | x | x |
| v7 | 5.3 Securely Store Master Images | | x | x |
