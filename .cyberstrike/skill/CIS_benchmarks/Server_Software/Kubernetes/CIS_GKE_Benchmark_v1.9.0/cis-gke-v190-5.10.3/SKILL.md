---
name: cis-gke-v190-5.10.3
description: "Consider GKE Sandbox for running untrusted workloads (Automated)"
category: cis-gke
version: "1.9.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, cluster-config, sandbox, gvisor, workload-isolation, multi-tenant]
cis_id: "5.10.3"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.9.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.10.3 Consider GKE Sandbox for running untrusted workloads (Automated)

## Profile Applicability

- Level 2

## Description

Use GKE Sandbox to restrict untrusted workloads as an additional layer of protection when running in a multi-tenant environment.

## Rationale

GKE Sandbox provides an extra layer of security to prevent untrusted code from affecting the host kernel on your cluster nodes.

When you enable GKE Sandbox on a Node pool, a sandbox is created for each Pod running on a node in that Node pool. In addition, nodes running sandboxed Pods are prevented from accessing other GCP services or cluster metadata. Each sandbox uses its own userspace kernel.

Multi-tenant clusters and clusters whose containers run untrusted workloads are more exposed to security vulnerabilities than other clusters. Examples include SaaS providers, web-hosting providers, or other organizations that allow their users to upload and run code. A flaw in the container runtime or in the host kernel could allow a process running within a container to 'escape' the container and affect the node's kernel, potentially bringing down the node.

The potential also exists for a malicious tenant to gain access to and exfiltrate another tenant's data in memory or on disk, by exploiting such a defect.

## Impact

Using GKE Sandbox requires the node image to be set to Container-Optimized OS with containerd (`cos_containerd`).

It is not currently possible to use GKE Sandbox along with the following Kubernetes features:

- Accelerators such as GPUs or TPUs
- Istio
- Monitoring statistics at the level of the Pod or container
- Hostpath storage
- Per-container PID namespace
- CPU and memory limits are only applied for Guaranteed Pods and Burstable Pods, and only when CPU and memory limits are specified for all containers running in the Pod
- Pods using PodSecurityPolicies that specify host namespaces, such as hostNetwork, hostPID, or hostIPC
- Pods using PodSecurityPolicy settings such as privileged mode
- VolumeDevices
- Portforward
- Linux kernel security modules such as Seccomp, Apparmor, or Selinux Sysctl, NoNewPrivileges, bidirectional MountPropagation, FSGroup, or ProcMount

## Audit

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. Click on each cluster, and click on any Node pools that are not provisioned by default.
3. On the Node pool Details page, under the `Security` heading on the Node pool details page, check that `Sandbox with gVisor` is set to 'Enabled'.

The default node pool cannot use GKE Sandbox.

**Using Command Line:**

Run this command:

```bash
gcloud container node-pools describe $NODE_POOL --cluster $CLUSTER_NAME --zone $COMPUTE_ZONE --format json | jq '.config.sandboxConfig'
```

The output of the above command will return the following if the Node pool is running a sandbox:

```json
{
  "sandboxType": "gvisor"
}
```

If there is no sandbox, the above command output will be null (`{ }`).

The default node pool cannot use GKE Sandbox.

## Remediation

Once a node pool is created, GKE Sandbox cannot be enabled, rather a new node pool is required. The default node pool (the first node pool in your cluster, created when the cluster is created) cannot use GKE Sandbox.

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/.
2. Select a cluster and click `ADD NODE POOL`.
3. Configure the Node pool with following settings:
   - For the node version, select `v1.12.6-gke.8` or higher.
   - For the node image, select `Container-Optimized OS with Containerd (cos_containerd) (default)`.
   - Under `Security`, select `Enable sandbox with gVisor`.
4. Configure other Node pool settings as required.
5. Click `SAVE`.

**Using Command Line:**

To enable GKE Sandbox on an existing cluster, a new Node pool must be created, which can be done using:

```bash
gcloud container node-pools create <node_pool_name> --zone <compute_zone> --cluster <cluster_name> --image-type=cos_containerd --sandbox="type=gvisor"
```

## Default Value

By default, GKE Sandbox is disabled.

## References

1. https://cloud.google.com/kubernetes-engine/docs/concepts/sandbox-pods
2. https://cloud.google.com/kubernetes-engine/docs/concepts/node-pools
3. https://cloud.google.com/kubernetes-engine/docs/how-to/sandbox-pods

## Additional Information

The default node pool (the first node pool in your cluster, created when the cluster is created) cannot use GKE Sandbox.

When using GKE Sandbox, your cluster must have at least two node pools. You must always have at least one node pool where GKE Sandbox is disabled. This node pool must contain at least one node, even if all your workloads are sandboxed.

It is optional but recommended that you enable Stackdriver Logging and Stackdriver Monitoring, by adding the flag `--enable-stackdriver-kubernetes`. gVisor messages are logged.

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.8 Separate Production and Non-Production Systems |      | x    | x    |
| v7               | 18.9 Separate Production and Non-Production Systems |      | x    | x    |
