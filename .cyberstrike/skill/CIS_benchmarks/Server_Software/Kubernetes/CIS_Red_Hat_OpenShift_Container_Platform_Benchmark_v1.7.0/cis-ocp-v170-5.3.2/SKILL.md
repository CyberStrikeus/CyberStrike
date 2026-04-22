---
name: cis-ocp-v170-5.3.2
description: "Ensure all Namespaces have Network Policies defined (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, network-policies, cni]
cis_id: "5.3.2"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 5.3.2

## Profile Applicability

- **Level:** 2

## Description

Use network policies to isolate traffic in your cluster network.

## Rationale

Running different applications on the same Kubernetes cluster creates a risk of one compromised application attacking a neighboring application. Network segmentation is important to ensure that containers can communicate only with those they are supposed to. A network policy is a specification of how selections of pods are allowed to communicate with each other and other network endpoints.

Once there is any Network Policy in a namespace selecting a particular pod, that pod will reject any connections that are not allowed by any Network Policy. Other pods in the namespace that are not selected by any Network Policy will continue to accept all traffic.

## Impact

Once there is any Network Policy in a namespace selecting a particular pod, that pod will reject any connections that are not allowed by any Network Policy. Other pods in the namespace that are not selected by any Network Policy will continue to accept all traffic.

## Audit Procedure

The OpenShift 4 CNI plugin uses network policies and by default all Pods in a project are accessible from other Pods and network endpoints. To isolate one or more Pods in a project, you create NetworkPolicy objects in that project to indicate the allowed incoming connections. Project administrators can create and delete NetworkPolicy objects within their own project. For more information see:

Run the following command and review the `NetworkPolicy` objects created in the cluster.

```bash
oc -n all get networkpolicy
```

Ensure that each namespace defined in the cluster has at least one Network Policy.

## Remediation

Follow the documentation and create `NetworkPolicy` objects as you need them.

## Default Value

By default, all Pods in a project are accessible from other Pods and network endpoints; network policies are not created.

## References

1. https://docs.openshift.com/container-platform/latest/networking/network_policy/about-network-policy.html
2. https://docs.openshift.com/container-platform/latest/networking/network_policy/creating-network-policy.html
3. https://docs.openshift.com/container-platform/latest/networking/network_policy/multitenant-network-policy.html
4. https://docs.openshift.com/container-platform/latest/networking/network_policy/default-network-policy.html
5. https://kubernetes.io/docs/concepts/services-networking/network-policies/
6. https://octetz.com/docs/2019/2019-04-22-netpol-api-k8s/
7. https://kubernetes.io/docs/tasks/administer-cluster/declare-network-policy/

## CIS Controls

| Controls Version | Control                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers | \*   | \*   | \*   |
| v7               | 14.2 Enable Firewall Filtering Between VLANs   |      | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations  |
| --------------------------- | ------- | ------------ |
| T1046                       | TA0007  | M1030, M1042 |

## Profile

**Level 2** (Manual)
