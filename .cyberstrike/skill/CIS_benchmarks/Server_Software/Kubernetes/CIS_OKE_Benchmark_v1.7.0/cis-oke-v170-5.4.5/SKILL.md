---
name: cis-oke-v170-5.4.5
description: "Encrypt traffic to HTTPS load balancers with TLS certificates (Manual)"
category: cis-oke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, managed-services, cluster-networking]
cis_id: "5.4.5"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.7.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.7.0 - Control 5.4.5

## Profile Applicability
- **Level:** 1

## Description
Encrypt traffic to HTTPS load balancers using TLS certificates.

## Rationale
Encrypting traffic between users and your Kubernetes workload is fundamental to protecting data sent over the web.

## Impact
None.

## Audit Procedure
Your load balancer vendor can provide details on auditing the certificates and policies required to utilize TLS.

## Remediation
Your load balancer vendor can provide details on configuring HTTPS with TLS.

## Default Value
By default, TLS is not configured on load balancers.

## References
1. https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.10 Encrypt Sensitive Data in Transit | | * | * |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1609 | TA0002 | M1035 |

## Profile
**Level 1** (Manual)
