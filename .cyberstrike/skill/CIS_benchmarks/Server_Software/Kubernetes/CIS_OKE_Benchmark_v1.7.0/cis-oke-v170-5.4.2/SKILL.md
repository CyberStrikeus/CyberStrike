---
name: cis-oke-v170-5.4.2
description: "Ensure clusters created with Private Endpoint Enabled and Public Access Disabled (Automated)"
category: cis-oke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, managed-services, cluster-networking]
cis_id: "5.4.2"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.7.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.7.0 - Control 5.4.2

## Profile Applicability
- **Level:** 1

## Description
Disable access to the Kubernetes API from outside the node network if it is not required.

## Rationale
In a private cluster, the master node has two endpoints, a private and public endpoint. The private endpoint is the internal IP address of the master, behind an internal load balancer in the master's VPC network. Nodes communicate with the master using the private endpoint. The public endpoint enables the Kubernetes API to be accessed from outside the master's VPC network.

Although Kubernetes API requires an authorized token to perform sensitive actions, a vulnerability could potentially expose the Kubernetes publically with unrestricted access. Additionally, an attacker may be able to identify the current cluster and Kubernetes API version and determine whether it is vulnerable to an attack. Unless required, disabling public endpoint will help prevent such threats, and require the attacker to be on the master's VPC network to perform any attack on the Kubernetes API.

## Impact
This topic gives an overview of the options for enabling private access to services within Oracle Cloud Infrastructure. Private access means that traffic does not go over the internet. Access can be from hosts within your virtual cloud network (VCN) or your on-premises network.

- You can enable private access to certain services within Oracle Cloud Infrastructure from your VCN or on-premises network by using either a private endpoint or a service gateway. See the sections that follow.
- For each private access option, these services or resource types are available:
    - With a private endpoint: Autonomous Database (shared Exadata infrastructure)
    - With a service gateway: Available services
- With either private access option, the traffic stays within the Oracle Cloud Infrastructure network and does not traverse the internet. However, if you use a service gateway, requests to the service use a public endpoint for the service.
- If you do not want to access a given Oracle service through a public endpoint, Oracle recommends using a private endpoint in your VCN (assuming the service supports private endpoints). A private endpoint is represented as a private IP address within a subnet in your VCN.

See [About Private Endpoints](https://docs.cloud.oracle.com/en-us/iaas/Content/Network/Concepts/privateaccess.htm)

## Audit Procedure
Check for the following:

```bash
export OKE_CLUSTERID=<oke cluster id>
oci ce cluster get --cluster-id $OKE_CLUSTERID
```

## Remediation
Enable Private Endpoint and disable Public Access for the cluster.

## Default Value
By default, the Public Endpoint is disabled.

## References
1. https://docs.cloud.oracle.com/en-us/iaas/Content/Network/Concepts/privateaccess.htm

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 9.3 Maintain and Enforce Network-Based URL Filters | | * | * |
| v7 | 7.4 Maintain and Enforce Network-Based URL Filters | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|

## Profile
**Level 1** (Automated)
