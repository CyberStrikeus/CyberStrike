---
name: cis-oke-v180-4.5.3
description: "The default namespace should not be used (Automated)"
category: cis-oke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, general-policies]
cis_id: "4.5.3"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.5.3 The default namespace should not be used (Automated)

## Profile Applicability

- Level 1

## Description

Kubernetes provides a default namespace, where objects are placed if no namespace is specified for them. Placing objects in this namespace makes application of RBAC and other controls more difficult.

## Rationale

Resources in a Kubernetes cluster should be segregated by namespace, to allow for security controls to be applied at that level and to make it easier to manage resources.

## Impact

None

## Audit

Run this command to list objects in default namespace:

```bash
kubectl get all -n default
```

The only entries there should be system managed resources such as the `kubernetes` service.

OR

```bash
kubectl get pods -n default
```

Returning No resources found in default namespace.

## Remediation

Ensure that namespaces are created to allow for appropriate segregation of Kubernetes resources and that all new resources are created in a specific namespace.

## Default Value

Unless a namespace is specific on object creation, the `default` namespace will be used.

## References

1. https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 12.2 Establish and Maintain a Secure Network Architecture | | x | x |
| v7 | 12.7 Deploy Network-Based Intrusion Prevention Systems | | | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1578 | TA0005 | M1018 |
