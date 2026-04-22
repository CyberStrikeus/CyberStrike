---
name: cis-ocp-vm-v100-1-11
description: "Restrict exec access to the pods (Manual)"
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
    pod-exec,
    least-privilege,
  ]
cis_id: "1.11"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.11 — Restrict exec access to the pods

## Profile Applicability

- Level 1

## Description

The ability to `exec` commands in a pod allows for arbitrary execution by users. This includes administrative functions which normally require elevation of privileges by an approved administrator, and could lead to unauthorized use of both security and non-security related administrative functions.

## Rationale

The exec command is not necessary for the proper functioning of OpenShift Virtualization.

## Impact

Limiting access to exec can restrict access to utilities used to accomplish tasks users are authorized to perform. These restrictions may require more granular role or attribute based access controls to be defined.

## Audit Procedure

To verify who can exec commands in pods, use the following command:

```bash
$ oc adm policy who-can exec pod
```

## Remediation

Assign `exec` access to `pods` in the cluster only to approved administrators.

## Default Value

The ability to run `exec` commands is reserved for cluster administrators by default.

## References

- CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0, Section 1.11

## CIS Controls

| Controls Version | Control                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4 Secure Configuration of Enterprise Assets and Software | N    | N    | N    |
| v7               | 5.1 Establish Secure Configurations                      | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic           | Technique                              |
| ---------------- | -------------------------------------- |
| Execution        | T1609 Container Administration Command |
| Lateral Movement | T1021 Remote Services                  |

## Profile

- Level 1 - OpenShift Virtualization
