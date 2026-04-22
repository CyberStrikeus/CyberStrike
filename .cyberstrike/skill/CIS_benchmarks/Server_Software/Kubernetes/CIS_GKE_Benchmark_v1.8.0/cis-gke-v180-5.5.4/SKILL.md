---
name: cis-gke-v180-5.5.4
description: "When creating New Clusters - Automate GKE version management using Release Channels (Automated)"
category: cis-gke
version: "1.8.0"
author: cyberstrike-official
tags:
  [
    cis,
    gke,
    kubernetes,
    gcp,
    node-configuration,
    container-optimized-os,
    auto-repair,
    auto-upgrade,
    release-channels,
    shielded-nodes,
  ]
cis_id: "5.5.4"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.8.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.5.4 When creating New Clusters - Automate GKE version management using Release Channels (Automated)

## Profile Applicability

- Level 1

## Description

Subscribe to the Regular or Stable Release Channel to automate version upgrades to the GKE cluster and to reduce version management complexity to the number of features and level of stability required.

## Rationale

Release Channels signal a graduating level of stability and production-readiness. These are based on observed performance of GKE clusters running that version and represent experience and confidence in the cluster version.

The Regular release channel upgrades every few weeks and is for production users who need features not yet offered in the Stable channel. These versions have passed internal validation, but don't have enough historical data to guarantee their stability. Known issues generally have known workarounds.

The Stable release channel upgrades every few months and is for production users who need stability above all else, and for whom frequent upgrades are too risky. These versions have passed internal validation and have been shown to be stable and reliable in production, based on the observed performance of those clusters.

Critical security patches are delivered to all release channels.

## Impact

Once release channels are enabled on a cluster, they cannot be disabled. To stop using release channels, the cluster must be recreated without the `--release-channel` flag.

Node auto-upgrade is enabled (and cannot be disabled), so the cluster is updated automatically from releases available in the chosen release channel.

## Audit

Using Google Cloud Console:

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. From the list of clusters, select the desired cluster.
3. Within the Details pane, if using a release channel, the release channel should be set to the `Regular` or `Stable` channel.

Using Command Line:
To check for Release Channel within a cluster, first define 2 variables for Cluster Name and Zone and then run the following command:

```
gcloud container clusters describe $CLUSTER_NAME --zone $COMPUTE_ZONE --format json | jq .releaseChannel.channel
```

Ensure the output of the above command has JSON key attribute channel set to REGULAR or STABLE:

```json
"releaseChannel": {
    "channel": "REGULAR"
  },
```

The output of the above command will return `regular` or `stable` if these release channels are being used to manage automatic upgrades for the cluster.

## Remediation

Currently, cluster Release Channels are only configurable at cluster provisioning time.

Using Google Cloud Console:

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. Click `CREATE`, and choose `CONFIGURE` for the required cluster mode.
3. Under the Control plane version heading, click the `Release Channels` button.
4. Select the `Regular` or `Stable` channels from the Release Channel drop-down menu.
5. Configure the rest of the cluster settings as required.
6. Click `CREATE`.

Using Command Line:
Create a new cluster by running the following command:

```
gcloud container clusters create <cluster_name> --zone <compute_zone> --release-channel <release_channel>
```

where `<release_channel>` is `stable` or `regular`, according to requirements.

## Default Value

Currently, release channels are not enabled by default.

## References

1. https://cloud.google.com/kubernetes-engine/docs/concepts/release-channels
2. https://cloud.google.com/kubernetes-engine/docs/how-to/node-auto-upgrades
3. https://cloud.google.com/kubernetes-engine/docs/how-to/maintenance-windows-and-exclusions

## CIS Controls

| Controls Version | Control                                                      | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 7.4 Perform Automated Application Patch Management           | x    | x    | x    |
| v7               | 3.4 Deploy Automated Operating System Patch Management Tools | x    | x    | x    |
| v7               | 3.5 Deploy Automated Software Patch Management Tools         | x    | x    | x    |
