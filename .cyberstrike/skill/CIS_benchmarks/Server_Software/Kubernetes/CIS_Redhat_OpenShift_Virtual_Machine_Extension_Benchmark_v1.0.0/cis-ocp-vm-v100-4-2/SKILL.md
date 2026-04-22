---
name: cis-ocp-vm-v100-4-2
description: "Enable MAC spoof filtering (Automated)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, openshift-virtualization, kubevirt, vm, networking-components]
cis_id: "4.2"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.2 — Enable MAC spoof filtering

## Profile Applicability

- Level 1

## Description

Mac spoof filtering is a feature that helps prevent man-in-the-middle attacks by verifying the authenticity of MAC addresses in network packets. By checking the MAC address of incoming packets, mac-spoof filtering can help ensure that only authorized devices are able to communicate with a particular device or network.

## Rationale

MAC spoof filtering prevents unauthorized access to system components and data.

## Impact

None.

## Audit Procedure

Enable MAC spoof filtering, allowing a given virtual machine to only connect to the network from its allocated MAC address.

For SR-IOV, use the following command:

```
$ oc get sriovnetwork -o json | jq ".items[].spec.spoofChk"
```

Verify the output is `on` for each network. Please referto the latest OpenShift documentation for more information.

For Bridge CNI, use the following command:

```
$ oc get networkattachmentdefinition -o json | jq ".items[].spec.config.macspoofchk"
```

Verify the output is `true` for each network attachment definition. Please refer to the latest OpenShift documentation for more information.

## Remediation

Enable MAC-spoof filtering per the deployed networking provider instructions. Instructions for Bridge CNI and SR-IOV CNI.

## Default Value

OVN Kubernetes localnet enables MAC spoof filtering by default.

## References

None listed in the PDF.

## CIS Controls

| Controls Version | Control                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers  | Y    | Y    | Y    |
| v7               | 12.4 Deny Communication over Unauthorized Ports | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic            | Technique                       |
| ----------------- | ------------------------------- |
| Credential Access | T1557 - Adversary-in-the-Middle |
| Lateral Movement  | T1557.002 - ARP Cache Poisoning |

## Profile

- Level 1 - OpenShift Virtualization
