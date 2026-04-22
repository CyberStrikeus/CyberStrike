---
name: cis-oke-v170-5.4.3
description: "Ensure clusters are created with Private Nodes (Automated)"
category: cis-oke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, managed-services, cluster-networking]
cis_id: "5.4.3"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.7.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.7.0 - Control 5.4.3

## Profile Applicability
- **Level:** 1

## Description
Disable public IP addresses for cluster nodes, so that they only have private IP addresses. Private Nodes are nodes with no public IP addresses.

## Rationale
Disabling public IP addresses on cluster nodes restricts access to only internal networks, forcing attackers to obtain local network access before attempting to compromise the underlying Kubernetes hosts.

## Impact
To enable Private Nodes, the cluster has to also be configured with a private master IP range and IP Aliasing enabled.

Private Nodes do not have outbound access to the public internet. If you want to provide outbound Internet access for your private nodes, you can use Cloud NAT or you can manage your own NAT gateway.

## Audit Procedure
Check for the following:

```bash
export OKE_NODEPOOLID=<node pool id>
export OKE_NODEID=<node id>

oci ce node-pool get --node-pool-id ${OKE_NODEPOOLID=} --node-id ${OKE_NODEID=} [--query <query>] [--auth <auth-token>] [--profile <profile-name>] [--region <region>]
```

## Remediation
Enable Private Nodes for the cluster.

## Default Value
By default, Private Nodes are disabled.

## References
1. https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process | * | * | * |
| v7 | 5.1 Establish Secure Configurations | * | * | * |
| v7 | 12 Boundary Defense | | | |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1556, T1611 | TA0004, TA0006 | M1048 |

## Profile
**Level 1** (Automated)
