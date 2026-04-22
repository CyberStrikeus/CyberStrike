---
name: cis-oke-v180-5.4.3
description: "Ensure clusters are created with Private Nodes (Automated)"
category: cis-oke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, managed-services, cluster-networking, private-nodes, node-pool, vcn, nat-gateway]
cis_id: "5.4.3"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.3 Ensure clusters are created with Private Nodes (Automated)

## Profile Applicability

- Level 1

## Description

Creating Oracle Kubernetes Engine (OKE) clusters with Private Nodes ensures that worker nodes do not have public IP addresses and communicate only within the Oracle Cloud Infrastructure (OCI) Virtual Cloud Network (VCN). This configuration isolates all node-level traffic from the public internet, significantly reducing the risk of external attacks and unauthorized access. Private nodes enhance security by enforcing internal-only communication between workloads, control plane, and OCI services -- while still allowing secure outbound access through NAT gateways when needed.

Disable public IP addresses for cluster nodes, so that they only have private IP addresses. Private Nodes are nodes with no public IP addresses.

## Rationale

Disabling public IP addresses on cluster nodes restricts access to only internal networks, forcing attackers to obtain local network access before attempting to compromise the underlying Kubernetes hosts.

## Impact

To enable Private Nodes, the cluster has to be also configured with a private master IP range and IP Aliasing enabled.

Private Nodes do not have outbound access to the public internet. If you want to provide outbound Internet access for your private nodes, you can use Cloud NAT or you can manage your own NAT gateway.

## Audit

Below is a command line statement to list OKE clusters whose node pools that use private nodes (i.e., nodes without public IPs):

```bash
echo -e "CLUSTER_ID\tNODE_POOL_NAME\tPRIVATE_NODES_ENABLED" && \
oci ce node-pool list --compartment-id "${COMPARTMENT_ID}" --all --output json \
| jq -r '
  .data[]? as $np
  | ($np.clusterId // $np.cluster_id // $np."cluster-id" // "-") as $cid
  | ($np.nodeConfigDetails.isNodePublicIpEnabled // false) as $pub
  | [$cid, ($np.name // "-"), (( $pub | not ) | tostring)] | @tsv
'
```

Sample Output:

```
CLUSTER_ID              NODE_POOL_NAME     PRIVATE_NODES_ENABLED
ocid1.cluster.oc1.phx.123  nodepool-prod      true
ocid1.cluster.oc1.phx.1234 dev-pool-01        false
```

## Remediation

If a node pool in your OKE cluster is configured with public IP addresses, update it to use private nodes to prevent direct internet exposure and ensure all traffic stays within the OCI Virtual Cloud Network (VCN).

```bash
oci ce node-pool update \
  --node-pool-id "${NODEPOOL_ID}" \
  --is-node-public-ip-enabled false \
  --force
```

## Default Value

By default, Private Nodes are disabled.

## CIS Controls

| Controls Version | Control                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.1 Establish and Maintain a Secure Configuration Process | x    | x    | x    |
| v7               | 5.1 Establish Secure Configurations                       | x    | x    | x    |
| v7               | 12 Boundary Defense                                       |      |      |      |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1556, T1611                | TA0004, TA0006 | M1048       |
