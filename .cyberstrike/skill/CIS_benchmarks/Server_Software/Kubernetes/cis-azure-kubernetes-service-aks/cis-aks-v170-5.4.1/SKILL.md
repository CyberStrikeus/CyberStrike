---
name: cis-aks-v170-5.4.1
description: "Restrict Access to the Control Plane Endpoint (Automated)"
category: cis-aks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, networking, control-plane, api-server, private-endpoint, authorized-ip]
cis_id: "5.4.1"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.7.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.1 Restrict Access to the Control Plane Endpoint (Automated)

## Profile Applicability

- Level 1

## Description

Enable Endpoint Private Access to restrict access to the cluster's control plane to only an allowlist of authorized IPs.

## Rationale

Authorized networks are a way of specifying a restricted range of IP addresses that are permitted to access your cluster's control plane. Kubernetes Engine uses both Transport Layer Security (TLS) and authentication to provide secure access to your cluster's control plane from the public internet. This provides you the flexibility to administer your cluster from anywhere; however, you might want to further restrict access to a set of IP addresses that you control. You can set this restriction by specifying an authorized network.

Restricting access to an authorized network can provide additional security benefits for your container cluster, including:

- Better protection from outsider attacks: Authorized networks provide an additional layer of security by limiting external access to a specific set of addresses you designate, such as those that originate from your premises. This helps protect access to your cluster in the case of a vulnerability in the cluster's authentication or authorization mechanism.
- Better protection from insider attacks: Authorized networks help protect your cluster from accidental leaks of master certificates from your company's premises. Leaked certificates used from outside Azure virtual machines and outside the authorized IP ranges (for example, from addresses outside your company) are still denied access.

## Impact

When implementing Endpoint Private Access, be careful to ensure all desired networks are on the allowlist (whitelist) to prevent inadvertently blocking external access to your cluster's control plane.

Limitations: IP authorized ranges can't be applied to the private api server endpoint, they only apply to the public API server. Availability Zones are currently supported for certain regions. Azure Private Link service limitations apply to private clusters. No support for Azure DevOps Microsoft-hosted Agents with private clusters. Consider to use Self-hosted Agents. For customers that need to enable Azure Container Registry to work with private AKS, the Container Registry virtual network must be peered with the agent cluster virtual network.

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
  "authorizedIpRanges": ["203.0.113.10/32", "198.51.100.0/24"]
}
```

This command queries for the enablePublicFqdn property within the apiServerAccessProfile of your AKS cluster. The output will be true if endpointPublicAccess is enabled, allowing access to the AKS cluster API server from the internet. If it's false, endpointPublicAccess is disabled, meaning the API server is not accessible over the internet, which is a common configuration for private clusters.

This command queries the enablePrivateCluster property within the apiServerAccessProfile of your AKS cluster. If the output is true, it indicates that endpointPrivateAccess is enabled, and the AKS cluster API server is configured to be accessible only via a private endpoint. If the output is false, the cluster is not configured for private access only, and the API server might be accessible over the internet depending on other settings.

This command queries for the authorizedIpRanges property within the apiServerAccessProfile of your AKS cluster. The output will list the IP ranges that are authorized to access the AKS cluster's API server over the internet. If the list is empty, it means there are no restrictions, and any IP can access the AKS cluster's API server, assuming other network and security configurations allow it.

## Remediation

By enabling private endpoint access to the Kubernetes API server, all communication between your nodes and the API server stays within your VPC. You can also limit the IP addresses that can access your API server from the internet, or completely disable internet access to the API server.

With this in mind, you can update your cluster accordingly using the AKS CLI to ensure that Private Endpoint Access is enabled.

If you choose to also enable Public Endpoint Access then you should also configure a list of allowable CIDR blocks, resulting in restricted access from the internet. If you specify no CIDR blocks, then the public API server endpoint is able to receive and process requests from all IP addresses by defaulting to ['0.0.0.0/0'].

For example, the following command would enable private access to the Kubernetes API as well as limited public access over the internet from a single IP address (noting the /32 CIDR suffix).

## Default Value

By default, Endpoint Private Access is disabled.

## References

1. https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-network-security#ns-1-implement-security-for-internal-traffic

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |
