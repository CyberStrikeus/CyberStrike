---
name: cis-oke-v170-5.4.1
description: "Restrict Access to the Control Plane Endpoint (Automated)"
category: cis-oke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, managed-services, cluster-networking]
cis_id: "5.4.1"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.7.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.7.0 - Control 5.4.1

## Profile Applicability
- **Level:** 1

## Description
Enable Master Authorized Networks to restrict access to the cluster's control plane (master endpoint) to only an allowlist (whitelist) of authorized IPs.

## Rationale
Authorized networks are a way of specifying a restricted range of IP addresses that are permitted to access your cluster's control plane. Kubernetes Engine uses both Transport Layer Security (TLS) and authentication to provide secure access to your cluster's control plane from the public internet. This provides you the flexibility to administer your cluster from anywhere; however, you might want to further restrict access to a set of IP addresses that you control. You can set this restriction by specifying an authorized network.

Restricting access to an authorized network can provide additional security benefits for your container cluster, including:

- Better protection from outsider attacks: Authorized networks provide an additional layer of security by limiting external, non-OCP access to a specific set of addresses you designate, such as those that originate from your premises. This helps protect access to your cluster in the case of a vulnerability in the cluster's authentication or authorization mechanism.
- Better protection from insider attacks: Authorized networks help protect your cluster from accidental leaks of master certificates from your company's premises. Leaked certificates used from outside OCP and outside the authorized IP ranges (for example, from addresses outside your company) are still denied access.

## Impact
When implementing Master Authorized Networks, be careful to ensure all desired networks are on the allowlist (whitelist) to prevent inadvertently blocking external access to your cluster's control plane.

## Audit Procedure
Check for the following:

```bash
export OKE_CLUSTERID=<oke cluster id>
oci ce cluster get --cluster-id $OKE_CLUSTERID
```

Check for endpoint URL of the Kubernetes API Server in output.

## Remediation
Enable Master Authorized Networks for the cluster and configure the appropriate allowlist of authorized IP addresses.

## Default Value
By default, Master Authorized Networks is disabled.

## References
1. https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 9.3 Maintain and Enforce Network-Based URL Filters | | * | * |
| v7 | 7.5 Subscribe to URL-Categorization service | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|

## Profile
**Level 1** (Automated)
