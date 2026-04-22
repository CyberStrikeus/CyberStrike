---
name: cis-ocp-vm-v100-3-2
description: "Disable Shareable disks (Automated)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, openshift-virtualization, kubevirt, vm, storage-components]
cis_id: "3.2"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 3.2 — Disable Shareable disks

## Profile Applicability

- Level 1

## Description

Sharable disks are shared between VMs, and they can be used only if a filesystem installed on top of it is a cluster-file system or the application using the device is distributed and cloud aware. Their wrong usage might cause data corruption.

## Rationale

Sharing system resources increases the risk of unauthorized access to data, manipulation of data flow restrictions, and could lead to corruption and data loss.

## Impact

Sharable disks are one means of sharing data between workloads, which cannot be used if this feature is avoided.

## Audit Procedure

Inspect virtual machine volumes and ensure the shareable flag is not set to `true`:

```
$ oc get vm -ojson -A | jq '.items[] | select(.spec.template.spec.domain.devices.disks[].shareable == true)| .metadata.namespace + "/" + .metadata.name'
```

## Remediation

Remove the shareable flag from any diskwhere it is found. For example, to remove the shareable flag on the first disk (index 0) of a given VM, this command can be used:

```
$ oc patch vm <vm-name> --type='json' -p='[
    {"op": "remove", "path": "/spec/template/spec/domain/devices/disks/0/shareable"},
]'
```

To set a shareable flag to false on every disk, this (experimental) command can be used:

```
$ oc get vm <vm-name> -o json | jq '.spec.template.spec.domain.devices.disks[] += {"shareable":false}' | oc apply -f -
```

## Default Value

Shareable disks are not enabled by default. The command should return an `empty` list.

## References

None listed in the PDF.

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | N    | Y    | Y    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic     | Technique                       |
| ---------- | ------------------------------- |
| Collection | T1530 - Data from Cloud Storage |
| Impact     | T1485 - Data Destruction        |

## Profile

- Level 1 - OpenShift Virtualization
