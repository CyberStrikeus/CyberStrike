---
name: cis-oke-v150-4.5.3
description: "The default namespace should not be used (Automated)"
category: cis-oke
version: "1.5.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, general-policies, namespace]
cis_id: "4.5.3"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.5.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.5.0 - Control 4.5.3

## Profile Applicability

- **Level:** 1

## Description

Kubernetes provides a default namespace, where objects are placed if no namespace is specified for them. Placing objects in this namespace makes application of RBAC and other controls more difficult.

## Rationale

Resources in a Kubernetes cluster should be segregated by namespace, to allow for security controls to be applied at that level and to make it easier to manage resources.

## Impact

None

## Audit Procedure

Run the following command to list all resources in the default namespace:

```bash
kubectl get $(kubectl api-resources --verbs=list --namespaced=true -o name | paste -sd, -) --ignore-not-found -n default
```

The only entries there should be system-managed resources such as the `kubernetes` service.

Alternatively, run a simpler check:

```bash
kubectl get all -n default
```

The only entry should be a service called `kubernetes`.

## Remediation

Ensure that namespaces are created to allow for appropriate segregation of Kubernetes resources and that all new resources are created in a specific namespace.

Create dedicated namespaces for your workloads:

```bash
kubectl create namespace <namespace_name>
```

Deploy resources to specific namespaces:

```bash
kubectl apply -f <resource.yaml> -n <namespace_name>
```

## Default Value

Unless a namespace is specific, the default namespace will be used.

## References

1. https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/

## Additional Information

Using dedicated namespaces for different workloads provides better isolation, makes RBAC policies easier to implement, and improves overall cluster organization and security posture.

## CIS Controls

| Controls Version | Control                                                                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 12.2 Establish and Maintain a Secure Network Architecture                                         |      | \*   | \*   |
| v7               | 12.7 Ensure Remote Devices Utilize a VPN and are Connecting to an Enterprise's AAA Infrastructure |      |      | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1578                       | TA0005  | M1018       |

## Profile

**Level 1** (Automated)
