---
name: cis-oke-v150-4.5.1
description: "Create administrative boundaries between resources using namespaces (Manual)"
category: cis-oke
version: "1.5.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, general-policies]
cis_id: "4.5.1"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.5.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.5.1 Create administrative boundaries between resources using namespaces (Manual)

## Profile Applicability

- Level 1

## Description

Use namespaces to isolate your Kubernetes objects.

## Rationale

Limiting the scope of user permissions can reduce the impact of mistakes or malicious activities. A Kubernetes namespace allows you to partition created resources into logically named groups. Resources created in one namespace can be hidden from other namespaces. By default, each resource created by a user in Kubernetes cluster runs in a default namespace, called `default`. You can create additional namespaces and attach resources and users to them. You can use Kubernetes Authorization plugins to create policies that segregate access to namespace resources between different users.

## Impact

You need to switch between namespaces for administration.

## Audit Procedure

Run the below command and review the namespaces created in the cluster.

```bash
kubectl get namespaces
```

Ensure that these namespaces are the ones you need and are adequately administered as per your requirements.

## Remediation

Follow the documentation and create namespaces for objects in your deployment as you need them.

## Default Value

By default, Kubernetes starts with two initial namespaces:

1. `default` - The default namespace for objects with no other namespace
2. `kube-system` - The namespace for objects created by the Kubernetes system
3. `kube-public` - The namespace for public-readable ConfigMap
4. `kube-node-lease` - The namespace for associated lease object for each node

## References

1. [https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/)
2. [http://blog.kubernetes.io/2016/08/security-best-practices-kubernetes-deployment.html](http://blog.kubernetes.io/2016/08/security-best-practices-kubernetes-deployment.html)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process | X | X | X |
| v7 | 14 Controlled Access Based on the Need to Know | | | |
| v6 | 14 Controlled Access Based on the Need to Know | | | |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1106, T1609 | TA0002 | M1038 |

---

**Profile:** Level 1
