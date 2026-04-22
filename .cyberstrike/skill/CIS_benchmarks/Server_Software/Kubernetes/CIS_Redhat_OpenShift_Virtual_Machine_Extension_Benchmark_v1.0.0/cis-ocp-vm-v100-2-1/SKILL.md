---
name: cis-ocp-vm-v100-2-1
description: "Restrict pass through of GPUs and Host devices to the Virtual Machine (Manual)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, openshift-virtualization, kubevirt, vm, virtual-machine-configuration]
cis_id: "2.1"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.1 — Restrict pass through of GPUs and Host devices to the Virtual Machine

## Profile Applicability
- Level 1

## Description
The ability to pass through certain devices like a GPU or NVMe can improve performance by offloading certain tasks from the CPU to the device itself, but it also introduces shared system resources and additional attack vectors for bad actors. Configuring GPUs or host devices for the virtual machine can put the guest at risk. It's important to be selective and only enable passthrough for devices that are critical to the operation of your workloads.

## Rationale
GPUs and host devices are directly passed to the Virtual Machine for better performance, but it also constitutes a risk if the device has been infected.

## Impact
Avoiding the usage of GPUs and host devices can prevent the users to run high performance workloads or achieving good performance for NVMe devices.

## Audit Procedure
Use the following command to list `gpus` associated with a virtual machine:

```
$ oc get vm -A -ojson | jq '.items[] | select(.spec.template.spec.domain.devices.gpus | length > 0) | {vm_name: .metadata.name, namespace: .metadata.namespace, gpus: .spec.template.spec.domain.devices.gpus}'
```

Use the following command to list `hostDevices` associated with a virtual machine:

```
$ oc get vm -A -ojson | jq '.items[].spec.template.spec.domain.devices.hostDevices'
```

This check applies to `any created` VMs.

Results of this query will be in this form:

```
[
  {
    "deviceName": "<resource-name>",
    "name": "<device-name>"
  },
  {
    "deviceName": "<resource-name>",
    "name": "<device-name>"
  }
]
```

## Remediation
Only enable approved devices which are trust-worthy and strictly necessary by the workload. For example, if the first host device above (index 0, in bold) should not be permitted to be passed through to a given VM, here's how to remove it:

```
$ oc patch vm <vm-name> --type='json' -p='[
    {"op": "remove", "path": "/spec/template/spec/domain/devices/hostDevices/0"},
]'
```

## Default Value
By default, no GPUs or hostDevices are enabled by default on the VM.spec. The command should return an `empty` list.

## References
None listed in the PDF.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | N | Y | Y |
| v7 | 5.2 Maintain Secure Images | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Privilege Escalation | T1068 - Exploitation for Privilege Escalation |
| Initial Access | T1195 - Supply Chain Compromise |

## Profile
- Level 1 - OpenShift Virtualization
