---
name: cis-ocp-vm-v100-1-13
description: "Restrict access to create and modify the Virtual Machine Cluster Instance and Preference Types (Manual)"
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
    rbac,
    instance-types,
    preference-types,
  ]
cis_id: "1.13"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.13 — Restrict access to create and modify the Virtual Machine Cluster Instance and Preference Types

## Profile Applicability

- Level 1

## Description

An instance type is a reusable object used to create VMs with sane defaults based on the desired type of VM. Since the object is used to create instances of VMs in the entire cluster, its creation and update needs to be carefully and securely managed.

## Rationale

Because an instance type is used as a starting point to create multiple copies of other VMs, a mistake or insecure setting in the instance type will be propagated to all new VMs based on it.

## Impact

Workload owners who require the ability to create and modify functionality will be granted permission on an as-needed basis.

## Audit Procedure

Check who has the ability to create InstanceTypes with the following command:

```bash
$ oc adm policy who-can create,update virtualmachineclusterinstancetypes
```

## Remediation

Assign `create` and `update` access only to approved `virtualmachineclusterinstancetypes` objects in the cluster. Remove the create and update permission from users who are not authorized to perform the actions.

## Default Value

This permission is granted only to cluster admins by default.

## References

- CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0, Section 1.13

## CIS Controls

| Controls Version | Control                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4 Secure Configuration of Enterprise Assets and Software | N    | N    | N    |
| v8               | 6.8 Define and Maintain Role-Based Access Control        | N    | N    | Y    |
| v7               | 5.1 Establish Secure Configurations                      | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic               | Technique                  |
| -------------------- | -------------------------- |
| Persistence          | T1098 Account Manipulation |
| Privilege Escalation | T1078 Valid Accounts       |

## Profile

- Level 1 - OpenShift Virtualization
