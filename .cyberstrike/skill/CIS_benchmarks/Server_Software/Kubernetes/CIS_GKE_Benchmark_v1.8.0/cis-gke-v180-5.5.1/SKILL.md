---
name: cis-gke-v180-5.5.1
description: "Ensure Container-Optimized OS (cos_containerd) is used for GKE Node images (Automated)"
category: cis-gke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, node-configuration, container-optimized-os, auto-repair, auto-upgrade, release-channels, shielded-nodes]
cis_id: "5.5.1"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.8.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.5.1 Ensure Container-Optimized OS (cos_containerd) is used for GKE Node images (Automated)

## Profile Applicability

- Level 1

## Description

Use Container-Optimized OS (cos_containerd) as a managed, optimized and hardened base OS that limits the host's attack surface.

## Rationale

COS is an operating system image for Compute Engine VMs optimized for running containers. With COS, the containers can be brought up on Google Cloud Platform quickly, efficiently, and securely.

Using COS as the node image provides the following benefits:

- Run containers out of the box: COS instances come pre-installed with the container runtime and `cloud-init`. With a COS instance, the container can be brought up at the same time as the VM is created, with no on-host setup required.
- Smaller attack surface: COS has a smaller footprint, reducing the instance's potential attack surface.
- Locked-down by default: COS instances include a locked-down firewall and other security settings by default.

## Impact

If modifying an existing cluster's Node pool to run COS, the upgrade operation used is long-running and will block other operations on the cluster (including delete) until it has run to completion.

COS nodes also provide an option with `containerd` as the main container runtime directly integrated with Kubernetes instead of `docker`. Thus, on these nodes, Docker cannot view or access containers or images managed by Kubernetes. Applications should not interact with Docker directly. For general troubleshooting or debugging, use crictl instead.

## Audit

Using Google Cloud Console:

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. From the list of clusters, select the cluster under test.
3. Under the 'Node pools' section, make sure that for each of the Node pools, 'Container-Optimized OS (cos_containerd)' is listed in the 'Image type' column.

Using Command line:
To check Node image type for an existing cluster's Node pool, first define 3 variables for Node Pool, Cluster Name and Zone, and then run the following command:

```
gcloud container node-pools describe $NODE_POOL --cluster $CLUSTER_NAME --zone $COMPUTE_ZONE --format json | jq '.config.imageType'
```

The output of the above command should return the following output

```json
"config": {
  ..
  "imageType": "COS_CONTAINERD",
  ..
}
```

if COS_CONTAINERD is used for Node images.

## Remediation

Using Google Cloud Console:

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. Select the Kubernetes cluster which does not use COS.
3. Under the Node pools heading, select the Node Pool that requires alteration.
4. Click `EDIT`.
5. Under the Image Type heading click `CHANGE`.
6. From the pop-up menu select `Container-optimised OS with containerd (cos_containerd) (default)` and click `CHANGE`
7. Repeat for all non-compliant Node pools.

Using Command Line:
To set the node image to `cos` for an existing cluster's Node pool:

```
gcloud container clusters upgrade <cluster_name> --image-type cos_containerd --zone <compute_zone> --node-pool <node_pool_name>
```

## Default Value

Container-optimised OS with containerd (cos_containerd) (default) is the default option for a cluster node image.

## References

1. https://cloud.google.com/kubernetes-engine/docs/concepts/using-containerd
2. https://cloud.google.com/kubernetes-engine/docs/concepts/node-images

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 2.5 Allowlist Authorized Software | | x | x |
| v7 | 5.2 Maintain Secure Images | | x | x |
