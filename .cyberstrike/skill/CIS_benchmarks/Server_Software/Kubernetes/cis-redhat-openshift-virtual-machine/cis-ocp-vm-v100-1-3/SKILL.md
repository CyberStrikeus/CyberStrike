---
name: cis-ocp-vm-v100-1-3
description: "Disable persistentReservations feature gate (Automated)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags:
  [
    cis,
    openshift,
    kubernetes,
    openshift-virtualization,
    kubevirt,
    vm,
    platform-configuration,
    feature-gate,
    persistent-reservations,
    least-functionality,
  ]
cis_id: "1.3"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.3 — Disable persistentReservations feature gate

## Profile Applicability

- Level 1

## Description

Persistent reservations are used to reserve a shared LUN among multiple virtual machines. This feature is required when the Windows guest makes use of the Windows Shared Cluster Filesystem. Enabling persistent reservations introduces additional complexity and overhead, as it requires calculated management of resource allocation and monitoring to ensure that reservations are not overcommitted and do not impact the overall performance of the system.

Enabling the persistent reservations feature introduces and relies upon an optional component with elevated privileges (qemu-pr-helper).

It is recommended to disable persistent reservations if you are not planning to use Windows Shared Cluster Filesystem for any virtual machines running on your OpenShift Virtualization environment.

## Rationale

Persistent reservations in Virtualization are only required in specific use-cases. Restricting enabled features aligns with the concept of least functionality, reducing the operating risk a component introduces to a system.

## Impact

Disabling this feature will prevent the operation of workloads that rely on Windows Shared Cluster Filesystem.

## Audit Procedure

Use the following command to list persistent reservation settings for hyperconverged resources:

```bash
$ oc get hyperconverged kubevirt-hyperconverged -n openshift-cnv -ojsonpath='{.spec.featureGates.persistentReservation}'
```

It should return `false`.

## Remediation

Disable the persistent reservations feature by setting `persistentReservations` to `False` for applicable hyperconverged resources.

```bash
$ oc patch hyperconverged kubevirt-hyperconverged -n openshift-cnv --type='json' -p='[
{"op": "replace", "path": "/spec/featureGates/persistentReservation", "value": false },
]'
```

## Default Value

By default `persistentReservations` is disabled and set to `false`. It is recommended to be enabled only when Windows Shared Cluster Filesystem or similar applications are planned to be used.

## References

- CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0, Section 1.3

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | N    | Y    | Y    |
| v7               | 4.7 Limit Access to Script Tools                                                | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic               | Technique                                   |
| -------------------- | ------------------------------------------- |
| Privilege Escalation | T1068 Exploitation for Privilege Escalation |
| Defense Evasion      | T1562 Impair Defenses                       |

## Profile

- Level 1 - OpenShift Virtualization
