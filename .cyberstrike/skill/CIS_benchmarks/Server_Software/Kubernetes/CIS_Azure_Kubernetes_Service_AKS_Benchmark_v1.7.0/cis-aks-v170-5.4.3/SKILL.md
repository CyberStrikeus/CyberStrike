---
name: cis-aks-v170-5.4.3
description: "Ensure clusters are created with Private Nodes (Automated)"
category: cis-aks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, networking, private-nodes, private-cluster, node-security]
cis_id: "5.4.3"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.7.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.3 Ensure clusters are created with Private Nodes (Automated)

## Profile Applicability

- Level 1

## Description

Disable public IP addresses for cluster nodes, so that they only have private IP addresses. Private Nodes are nodes with no public IP addresses.

## Rationale

Disabling public IP addresses on cluster nodes restricts access to only internal networks, forcing attackers to obtain local network access before attempting to compromise the underlying Kubernetes hosts.

## Impact

To enable Private Nodes, the cluster has to also be configured with a private master IP range and IP Aliasing enabled.

Private Nodes do not have outbound access to the public internet. If you want to provide outbound Internet access for your private nodes, you can use Cloud NAT or you can manage your own NAT gateway.

## Audit

Check for the following to be 'enabled: true':

```bash
export CLUSTER_NAME=<your cluster name>
export RESOURCE_GROUP=<your resource group name>

az aks show --name ${CLUSTER_NAME} --resource-group ${RESOURCE_GROUP} --query "apiServerAccessProfile.enablePrivateCluster"
```

## Remediation

```bash
az aks create \
  --resource-group <private-cluster-resource-group> \
  --name <private-cluster-name> \
  --load-balancer-sku standard \
  --enable-private-cluster \
  --network-plugin azure \
  --vnet-subnet-id <subnet-id> \
  --docker-bridge-address \
  --dns-service-ip \
  --service-cidr
```

Where `--enable-private-cluster` is a mandatory flag for a private cluster.

## References

1. https://learn.microsoft.com/en-us/azure/aks/private-clusters

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.4 Implement and Manage a Firewall on Servers | x | x | x |
| v7 | 12 Boundary Defense | | | |
