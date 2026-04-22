---
name: cis-oke-v150-5.1.4
description: "Minimize Container Registries to only those approved (Manual)"
category: cis-oke
version: "1.5.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, managed-services, image-registry, image-scanning, ocir]
cis_id: "5.1.4"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.5.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.4 Minimize Container Registries to only those approved (Manual)

## Profile Applicability

- Level 1

## Description

Use approved container registries.

## Rationale

Allowing unrestricted access to external container registries provides the opportunity for malicious or unapproved containers to be deployed into the cluster. Allow listing only approved container registries reduces this risk.

## Impact

All container images to be deployed to the cluster must be hosted within an approved container image registry.

## Audit

No specific audit procedure provided. Review container registry policies and ensure only approved registries are configured for use with the cluster.

## Remediation

Configure policies to restrict container image sources to only approved registries.

## Default Value

Not configured by default.

## References

1. [https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm](https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm)

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v7               | 5.2 Maintain Secure Images - Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates. |      | x    | x    |
| v7               | 5.3 Securely Store Master Images - Store the master images and templates on securely configured servers, validated with integrity monitoring tools, to ensure that only authorized changes to the images are possible.                                                                          |      | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations  |
| --------------------------- | -------------- | ------------ |
| T1133, T1195                | TA0001, TA0003 | M1016, M1042 |

## Profile

Level 1 - OKE
