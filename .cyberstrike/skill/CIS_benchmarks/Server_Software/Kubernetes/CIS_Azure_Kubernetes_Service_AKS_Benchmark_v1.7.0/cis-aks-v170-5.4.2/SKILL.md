---
name: cis-aks-v170-5.4.2
description: "Ensure clusters are created with Private Endpoint Enabled and Public Access Disabled (Automated)"
category: cis-aks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, networking, private-endpoint, private-cluster, api-server]
cis_id: "5.4.2"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.7.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.2 Ensure clusters are created with Private Endpoint Enabled and Public Access Disabled (Automated)

## Profile Applicability

- Level 2

## Description

Disable access to the Kubernetes API from outside the node network if it is not required.

## Rationale

In a private cluster, the master node has two endpoints, a private and public endpoint. The private endpoint is the internal IP address of the master, behind an internal load balancer in the master's virtual network. Nodes communicate with the master using the private endpoint. The public endpoint enables the Kubernetes API to be accessed from outside the master's virtual network.

Although Kubernetes API requires an authorized token to perform sensitive actions, a vulnerability could potentially expose the Kubernetes publicly with unrestricted access. Additionally, an attacker may be able to identify the current cluster and Kubernetes API version and determine whether it is vulnerable to an attack. Unless required, disabling public endpoint will help prevent such threats, and require the attacker to be on the master's virtual network to perform any attack on the Kubernetes API.

## Audit

Check for the following are set as appropriate:

```bash
export CLUSTER_NAME=<your cluster name>
export RESOURCE_GROUP=<your resource group name>

az aks show \
  --name "${CLUSTER_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query "{enablePrivateCluster:apiServerAccessProfile.enablePrivateCluster, enablePublicFqdn:apiServerAccessProfile.enablePublicFqdn, authorizedIpRanges:apiServerAccessProfile.authorizedIpRanges}" \
  --output json
```

Output would be similar to:

```json
{
  "enablePrivateCluster": true,
  "enablePublicFqdn": false,
  "authorizedIpRanges": [
    "203.0.113.10/32",
    "198.51.100.0/24"
  ]
}
```

This command queries the enablePrivateCluster property within the apiServerAccessProfile of your AKS cluster. If the output is true, it indicates that endpointPrivateAccess is enabled, and the AKS cluster API server is configured to be accessible only via a private endpoint. If the output is false, the cluster is not configured for private access only, and the API server might be accessible over the internet depending on other settings.

## Remediation

To use a private endpoint, create a new private endpoint in your virtual network then create a link between your virtual network and a new private DNS zone.

## References

1. https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-network-security#ns-2-connect-private-networks-together
2. https://learn.microsoft.com/en-us/azure/aks/private-clusters

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.4 Implement and Manage a Firewall on Servers | x | x | x |
| v7 | 12 Boundary Defense | | | |
