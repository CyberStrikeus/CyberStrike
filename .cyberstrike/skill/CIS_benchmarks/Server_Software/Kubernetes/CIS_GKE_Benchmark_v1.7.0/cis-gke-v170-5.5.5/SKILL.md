---
name: cis-gke-v170-5.5.5
description: "Ensure Shielded GKE Nodes are Enabled (Automated)"
category: cis-gke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, node-config, shielded-nodes, secure-boot, vtpm, integrity]
cis_id: "5.5.5"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.7.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.5.5 Ensure Shielded GKE Nodes are Enabled (Automated)

## Profile Applicability

- Level 1

## Description

Shielded GKE Nodes provides verifiable integrity via secure boot, virtual trusted platform module (vTPM)-enabled measured boot, and integrity monitoring.

## Rationale

Shielded GKE nodes protects clusters against boot- or kernel-level malware or rootkits which persist beyond infected OS.

Shielded GKE nodes run firmware which is signed and verified using Google's Certificate Authority, ensuring that the nodes' firmware is unmodified and establishing the root of trust for Secure Boot. GKE node identity is strongly protected via virtual Trusted Platform Module (vTPM) and verified remotely by the master node before the node joins the cluster. Lastly, GKE node integrity (i.e., boot sequence and kernel) is measured and can be monitored and verified remotely.

## Impact

After Shielded GKE Nodes is enabled in a cluster, any nodes created in a Node pool without Shielded GKE Nodes enabled, or created outside of any Node pool, aren't able to join the cluster.

Shielded GKE Nodes can only be used with Container-Optimized OS (COS), COS with containerd, and Ubuntu node images.

## Audit

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list
2. Select the cluster under test from the list of clusters, and ensure that `Shielded GKE Nodes` are 'Enabled' under the Details pane.

**Using Command Line:**

Run the following command:

```bash
gcloud container clusters describe <cluster_name> --format json | jq '.shieldedNodes'
```

This will return the following if Shielded GKE Nodes are enabled:

```json
{
  "enabled": true
}
```

## Remediation

Note: From version 1.18, clusters will have Shielded GKE nodes enabled by default.

**Using Google Cloud Console:**

To update an existing cluster to use Shielded GKE nodes:

1. Navigate to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. Select the cluster which for which `Shielded GKE Nodes` is to be enabled.
3. With in the `Details` pane, under the `Security` heading, click on the pencil icon named `Edit Shields GKE nodes`.
4. Check the box named `Enable Shield GKE nodes`.
5. Click `SAVE CHANGES`.

**Using Command Line:**

To migrate an existing cluster, the flag `--enable-shielded-nodes` needs to be specified in the cluster update command:

```bash
gcloud container clusters update <cluster_name> --zone <cluster_zone> --enable-shielded-nodes
```

## Default Value

Clusters will have Shielded GKE nodes enabled by default, as of version v1.18

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/shielded-gke-nodes

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure | | x | x |
| v7 | 5.3 Securely Store Master Images | | x | x |
| v7 | 18.11 Use Standard Hardening Configuration Templates for Databases | | x | x |
