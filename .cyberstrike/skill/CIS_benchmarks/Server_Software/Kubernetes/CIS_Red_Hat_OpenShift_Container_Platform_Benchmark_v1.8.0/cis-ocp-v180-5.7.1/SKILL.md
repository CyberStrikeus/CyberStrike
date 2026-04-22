---
name: cis-ocp-v180-5.7.1
description: "Create administrative boundaries between resources using namespaces (Manual)"
category: cis-openshift
version: "1.8.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, general-policies]
cis_id: "5.7.1"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.8.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.8.0 - Control 5.7.1

## Profile Applicability

- **Level:** 1

## Description

Use namespaces to isolate your Kubernetes objects.

## Rationale

Limiting the scope of user permissions can reduce the impact of mistakes or malicious activities. A Kubernetes namespace allows you to partition created resources into logically named groups. Resources created in one namespace can be hidden from other namespaces. By default, each resource created by a user in Kubernetes cluster runs in a default namespace, called `default`. You can create additional namespaces and attach resources and users to them. You can use Kubernetes Authorization plugins to create policies that segregate access to namespace resources between different users.

## Impact

You need to switch between namespaces for administration.

## Audit Procedure

OpenShift Projects wrap Kubernetes namespaces and are used by default in OpenShift 4.

Run the following command to obtain a list of all non-default OpenShift and Kubernetes namespaces in the cluster.

```bash
oc get namespaces -o json | jq '.items[] |
select(.metadata.name|test("(?!default|kube-.|openshift.)^.*")) |
.metadata.name'
```

Ensure that these namespaces are the ones you need and are adequately administered as per your requirements.

## Remediation

Follow the documentation and create namespaces for objects in your deployment as you need them.

## Default Value

By default, Kubernetes starts with two initial namespaces:

1. `default` - The default namespace for objects with no other namespace
2. `kube-system` - The namespace for objects created by the Kubernetes system
3. `openshift` -
4. `openshift-*` - The namespace for objects created by OpenShift

## References

1. https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/
2. https://kubernetes.io/blog/2016/08/security-best-practices-kubernetes-deployment/

## CIS Controls

| Controls Version | Control                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers | \*   | \*   | \*   |
| v7               | 9.5 Implement Application Firewalls            |      |      | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1106, T1609                | TA0002, TA0008 | M1038       |

## Profile

**Level 1** (Manual)
