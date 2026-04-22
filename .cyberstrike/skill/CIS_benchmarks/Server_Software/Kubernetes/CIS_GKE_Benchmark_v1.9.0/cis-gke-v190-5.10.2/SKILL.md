---
name: cis-gke-v190-5.10.2
description: "Ensure that Alpha clusters are not used for production workloads (Automated)"
category: cis-gke
version: "1.9.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, cluster-config, alpha-cluster, production, sla]
cis_id: "5.10.2"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.9.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.10.2 Ensure that Alpha clusters are not used for production workloads (Automated)

## Profile Applicability

- Level 1

## Description

Alpha clusters are not covered by an SLA and are not production-ready.

## Rationale

Alpha clusters are designed for early adopters to experiment with workloads that take advantage of new features before those features are production-ready. They have all Kubernetes API features enabled, but are not covered by the GKE SLA, do not receive security updates, have node auto-upgrade and node auto-repair disabled, and cannot be upgraded. They are also automatically deleted after 30 days.

## Impact

Users and workloads will not be able to take advantage of features included within Alpha clusters.

## Audit

The audit script for this recommendation utilizes 3 variables:
$CLUSTER_NAME
$COMPUTE_ZONE
Please set these parameters on the system where you will be executing your gcloud audit script or command.

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting https://console.cloud.google.com/kubernetes/list
2. If a cluster appears under the 'Kubernetes alpha clusters' heading, it is an Alpha cluster.

**Using Command Line:**

Run the command:

```bash
gcloud container clusters describe $CLUSTER_NAME \
  --zone $COMPUTE_ZONE \
  --format json | jq '.enableKubernetesAlpha'
```

The output of the above command will return `true` if it is an Alpha cluster.

## Remediation

Alpha features cannot be disabled. To remediate, a new cluster must be created.

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting https://console.cloud.google.com/kubernetes/
2. Click CREATE CLUSTER, and choose "SWITCH TO STANDARD CLUSTER" in the upper right corner of the screen.
3. Under Features in the CLUSTER section, "Enable Kubernetes alpha features in this cluster" will not be available by default and to use Kubernetes alpha features in this cluster, first disable release channels.
   Note: It will only be available if the cluster is created with a Static version for the Control plane version, along with both Automatically upgrade nodes to the next available version and Enable auto-repair being checked under the Node pool details for each node.
4. Configure the other settings as required and click CREATE.

**Using Command Line:**

Upon creating a new cluster:

```bash
gcloud container clusters create [CLUSTER_NAME] \
  --zone [COMPUTE_ZONE]
```

Do not use the --enable-kubernetes-alpha argument.

## Default Value

By default, Kubernetes Alpha features are disabled.

## References

1. https://cloud.google.com/kubernetes-engine/docs/concepts/alpha-clusters

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 16.8 Separate Production and Non-Production Systems | | x | x |
| v7 | 18.9 Separate Production and Non-Production Systems | | x | x |
