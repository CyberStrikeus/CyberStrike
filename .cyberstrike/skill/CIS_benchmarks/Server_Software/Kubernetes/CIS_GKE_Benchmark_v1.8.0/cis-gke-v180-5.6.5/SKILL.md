---
name: cis-gke-v180-5.6.5
description: "Ensure clusters are created with Private Nodes (Automated)"
category: cis-gke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, cluster-networking, vpc-flow-logs, intranode-visibility, vpc-native, private-cluster, authorized-networks, firewall, ssl-certificates]
cis_id: "5.6.5"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.8.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.6.5 Ensure clusters are created with Private Nodes (Automated)

## Profile Applicability

- Level 1

## Description

Private Nodes are nodes with no public IP addresses. Disable public IP addresses for cluster nodes, so that they only have private IP addresses.

## Rationale

Disabling public IP addresses on cluster nodes restricts access to only internal networks, forcing attackers to obtain local network access before attempting to compromise the underlying Kubernetes hosts.

## Impact

To enable Private Nodes, the cluster has to also be configured with a private master IP range and IP Aliasing enabled.

Private Nodes do not have outbound access to the public internet. If you want to provide outbound Internet access for your private nodes, you can use Cloud NAT or you can manage your own NAT gateway.

To access Google Cloud APIs and services from private nodes, Private Google Access needs to be set on Kubernetes Engine Cluster Subnets.

## Audit

Using Google Cloud Console:

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. Select the desired cluster, and within the Details pane, make sure `Private Clusters` is set to `Enabled`.

Using Command Line:
To check Private Nodes status for an existing cluster, first define 2 variables Cluster Name and Zone and then run the following command:

```
gcloud container clusters describe $CLUSTER_NAME --zone $COMPUTE_ZONE --format json | jq '.privateClusterConfig.enablePrivateNodes'
```

The output of the above command returns

```json
{
    "enablePrivateNodes": true
}
```

if Private Nodes is enabled.

## Remediation

Once a cluster is created without enabling Private Nodes, it cannot be remediated. Rather the cluster must be recreated.
Using Google Cloud Console:

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. Click CREATE CLUSTER.
3. Configure the cluster as required then click Networking under CLUSTER in the navigation pane.
4. Under IPv4 network access, click the Private cluster radio button.
5. Configure the other settings as required, and click CREATE.

Using Command Line:
To create a cluster with Private Nodes enabled, include the `--enable-private-nodes` flag within the cluster create command:

```
gcloud container clusters create <cluster_name> --enable-private-nodes
```

Setting this flag also requires the setting of `--enable-ip-alias` and `--master-ipv4-cidr=<master_cidr_range>`.

## Default Value

By default, Private Nodes are disabled.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/latest/network-isolation

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.4 Implement and Manage a Firewall on Servers | x | x | x |
| v7 | 12 Boundary Defense | | | |
