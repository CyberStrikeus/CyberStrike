---
name: cis-ocp-vm-v100-4-3
description: "Use multi-network policies (Manual)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, openshift-virtualization, kubevirt, vm, networking-components]
cis_id: "4.3"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.3 — Use multi-network policies

## Profile Applicability
- Level 2

## Description
Micro-segmentation in VLANs is crucial for enhancing network security because it allows control of traffic flow between different components of the network and their services. This segmentation helps to contain potential security breaches and limit the spread of malware or unauthorized access to information.

## Rationale
Micro-segmentation enables better control over access privileges and traffic flow, allowing administrators to implement restrictive security policies and identify anomalous network activity more effectively.

## Impact
Once there is any Multi-network Policy in a namespace selecting a particular VM and the network it's connected to, that VM will reject any connections from the given network that are not allowed by any Multi-network Policy.

## Audit Procedure
By default, no MultiNetworkPolicies are defined. To segregate one or more VMs/Pods in a project, you create MultiNetworkPolicy objects in that project to indicate the allowed incoming connections on a given network. Project administrators can create and delete MultiNetworkPolicy objects within their own project.

Run the following command and review the MultiNetworkPolicy objects created in the cluster.

```
$ oc -n all get multi-networkpolicy
```

Ensure that each namespace defined in the cluster has at least one `Multi-network Policy`.

## Remediation
Follow the documentation linked below and create `Multi-Network Policy` objects as you need them.

Note: A Multi-network Policy must match a VM and also the `NetworkAttachmentDefinition` this VM is connected to.

## Default Value
Use MultiNetworkPolicies to configure micro segmentation within a VLAN. This feature is only available with OVN Kubernetes localnet. This feature is disabled by default.

## References
1. https://docs.openshift.com/container-platform/4.17/virt/vm_networking/virt-connecting-vm-to-ovn-secondary-network.html

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4.4 Implement and Manage a Firewall on Servers | Y | Y | Y |
| v7 | 14.2 Enable Firewall Filtering Between VLANs | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Lateral Movement | T1021 - Remote Services |
| Command and Control | T1071 - Application Layer Protocol |

## Profile
- Level 2 - OpenShift Virtualization
