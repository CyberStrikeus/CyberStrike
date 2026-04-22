---
name: cis-ocp-vm-v100-4-1
description: "Use dedicated VLANs to segment network traffic (Automated)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, openshift-virtualization, kubevirt, vm, networking-components]
cis_id: "4.1"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.1 — Use dedicated VLANs to segment network traffic

## Profile Applicability
- Level 1

## Description
To ensure that virtual machines cannot access each other's network interfaces, it is crucial to segment them completely using separate VLANs. By connecting virtual machines to logically separated VLANs, you enforce network segmentation at the L2 level, preventing virtual machines from unauthorized/unintended data transmission, and reducing the risk of security breaches or data leaks.

## Rationale
The importance of layer 2 network segmentation can be attributed to its ability to enhance network security by creating separate broadcast domains for different groups of devices on the network. These broadcast domains limit the spread of broadcast traffic, making it more difficult for malicious actors to propagate their attacks across the entire network.

## Impact
Segmenting workloads to dedicated VLANs also means they can't access services provided by other workloads unless they are in the same VLAN.

## Audit Procedure
Use the following command to determine if VLANs are configured for OVN Kubernetes:

```
$ oc get networkattachmentdefinition -o json | jq ".items[].spec.config"
```

Review the output to determine if VLANs are configured correctly:

```
config:|-
  {
    "type": "ovn-k8s-cni-overlay",
    "topology": "localnet",
    "vlanID": 100
  }
```

Please refer to the latest OpenShift documentation for more information.

Use the following command to determine if VLANs are configured for SR-IOV:

```
$ oc get sriovnetwork -o json | jq ".items[].spec.vlan"
```

Output will return `null` for networks without VLANs configured, or a VLAN ID (e.g.,`100`). Please refer to the latest OpenShift documentation for more information.

Use the following command to determine if VLANs are configured for Bridge CNI:

```
$ oc get networkattachmentdefinition -o json | jq ".items[].spec.config"
```

Review the output to determine if VLANs are configured correctly:

```
config: |
  {
    "type": "bridge",
    "vlan": 100,
    "preserveDefaultVlan": false
  }
```

Please refer to the latest OpenShift documentation for more information.

This is an opt-in feature. No virtual machines will have a dedicated VLAN unless configured per the networking provider instructions.

## Remediation
Use dedicated VLANs as required. Pleaserefer to the latest OpenShift documentation for the appropriate networking provider. Documentation:SR-IOV CNI,VLAN with bridge CNI,VLAN with OVN localnet.

## Default Value
Dedicated VLANs are not used by default.

## References
None listed in the PDF.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4.4 Implement and Manage a Firewall on Servers | Y | Y | Y |
| v8 | 9.2 Use DNS Filtering Services | Y | Y | Y |
| v7 | 7.7 Use of DNS Filtering Services | Y | Y | Y |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | N | Y | Y |
| v7 | 12.4 Deny Communication over Unauthorized Ports | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Lateral Movement | T1021 - Remote Services |
| Discovery | T1046 - Network Service Discovery |

## Profile
- Level 1 - OpenShift Virtualization
