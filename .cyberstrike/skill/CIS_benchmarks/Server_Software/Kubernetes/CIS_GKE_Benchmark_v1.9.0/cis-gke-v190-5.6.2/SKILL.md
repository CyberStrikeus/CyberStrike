---
name: cis-gke-v190-5.6.2
description: "Ensure use of VPC-native clusters (Automated)"
category: cis-gke
version: "1.9.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, networking, vpc-native, alias-ip, ip-allocation]
cis_id: "5.6.2"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.9.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.6.2 Ensure use of VPC-native clusters (Automated)

## Profile Applicability

- Level 1

## Description

Create Alias IPs for the node network CIDR range in order to subsequently configure IP-based policies and firewalling for pods. A cluster that uses Alias IPs is called a VPC-native cluster.

## Rationale

Using Alias IPs has several benefits:

- Pod IPs are reserved within the network ahead of time, which prevents conflict with other compute resources.
- The networking layer can perform anti-spoofing checks to ensure that egress traffic is not sent with arbitrary source IPs.
- Firewall controls for Pods can be applied separately from their nodes.
- Alias IPs allow Pods to directly access hosted services without using a NAT gateway.

## Impact

You cannot currently migrate an existing cluster that uses routes for Pod routing to a cluster that uses Alias IPs.

Cluster IPs for internal services remain only available from within the cluster. If you want to access a Kubernetes Service from within the VPC, but from outside of the cluster, use an internal load balancer.

## Audit

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. From the list of clusters, click on the desired cluster to open the Details page. Under the 'Networking' section, make sure 'VPC-native traffic routing' is set to 'Enabled'.

**Using Command Line:**

To check Alias IP is enabled for an existing cluster, run the following command:

```bash
gcloud container clusters describe <cluster_name> --zone <compute_zone> --format json | jq '.ipAllocationPolicy.useIpAliases'
```

The output of the above command should return `true`, if VPC-native (using alias IP) is enabled. If VPC-native (using alias IP) is disabled, the above command will return null (`{ }`).

## Remediation

Alias IPs cannot be enabled on an existing cluster. To create a new cluster using Alias IPs, follow the instructions below.

**Using Google Cloud Console:**

If using Standard configuration mode:

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list
2. Click `CREATE CLUSTER`, and select Standard configuration mode.
3. Configure your cluster as desired, then, click `Networking` under `CLUSTER` in the navigation pane.
4. In the 'VPC-native' section, leave 'Enable VPC-native (using alias IP)' selected.
5. Click CREATE.

If using Autopilot configuration mode:

Note that this is VPC-native only and cannot be disabled:

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. Click CREATE CLUSTER, and select Autopilot configuration mode.
3. Configure your cluster as required.
4. Click `CREATE`.

**Using Command Line:**

To enable Alias IP on a new cluster, run the following command:

```bash
gcloud container clusters create <cluster_name> --zone <compute_zone> --enable-ip-alias
```

If using Autopilot configuration mode:

```bash
gcloud container clusters create-auto <cluster_name> --zone <compute_zone>
```

## Default Value

By default, VPC-native (using alias IP) is enabled when you create a new cluster in the Google Cloud Console, however this is disabled when creating a new cluster using the gcloud CLI, unless the `--enable-ip-alias` argument is specified.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/alias-ips
2. https://cloud.google.com/kubernetes-engine/docs/concepts/alias-ips

## CIS Controls

| Controls Version | Control                                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 13.4 Perform Traffic Filtering Between Network Segments                              |      | x    | x    |
| v7               | 11 Secure Configuration for Network Devices, such as Firewalls, Routers and Switches |      |      |      |
| v7               | 14.1 Segment the Network Based on Sensitivity                                        |      | x    | x    |
