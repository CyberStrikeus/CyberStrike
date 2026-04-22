---
name: cis-ocp-v170-5.3.1
description: "Ensure CNI in use supports Network Policies (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, network-policies, cni]
cis_id: "5.3.1"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 5.3.1

## Profile Applicability

- **Level:** 1

## Description

There are a variety of CNI plugins available for Kubernetes. If the CNI in use does not support Network Policies it may not be possible to effectively restrict traffic in the cluster.

## Rationale

Kubernetes network policies are enforced by the CNI plugin in use. As such it is important to ensure that the CNI plugin supports both Ingress and Egress network policies.

## Impact

None

## Audit Procedure

Review the documentation of the CNI plugin (OpenShift SDN or OVN-Kubernetes) in use by the cluster, and confirm that it supports ingress and egress network policies.

OpenShift Container Platform uses a software-defined networking (SDN) approach to offer a unified cluster network that enables communication between Pods across the OpenShift Container Platform cluster. This Pod network can be established and maintained by either the OpenShift SDN plugin, which configures an overlay network using Open vSwitch (OVS), or by the OVN-Kubernetes plugin.

OVN-Kubernetes, based on Open Virtual Network (OVN), offers an overlay-based networking implementation. A cluster using the OVN-Kubernetes plugin also runs Open vSwitch (OVS) on each node. OVN configures OVS on each node to implement the declared network configuration.

As of OpenShift 4.10, both these plugins provide all Kubernetes Network Policy features, including ingress, egress, and `ipBlock`. OpenShift provides several options for controlling the traffic leaving the cluster, the supporting matrix can be found at. Please refer to the OpenShift documentation for a complete list of features available for securing cluster networks.

## Remediation

None required.

## Default Value

This will depend on the CNI plugin in use.

## References

1. https://docs.openshift.com/container-platform/4.5/networking/openshift-sdn/about-openshift-sdn.html
2. https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/network-plugins/

## CIS Controls

| Controls Version | Control                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers | \*   | \*   | \*   |
| v7               | 9.5 Implement Application Firewalls            |      |      | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations  |
| --------------------------- | ------- | ------------ |
| T1046                       | TA0007  | M1030, M1042 |

## Profile

**Level 1** (Manual)
