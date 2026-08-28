---
name: cis-ocp-vm-v100-1-12
description: "Restrict VNC access to cluster workloads (Manual)"
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
    vnc,
    rbac,
    access-control,
    console,
  ]
cis_id: "1.12"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.12 — Restrict VNC access to cluster workloads

## Profile Applicability

- Level 1

## Description

Access to each workload's virtual screen is provided via VNC. Permission to use VNC is granted via a role, which means users with role assigned can access the VNC console of all workloads in a namespace.

## Rationale

Access to use VNC should be carefully considered as it is usually preferable to access workloads via other means which support a stronger encryption and authentication mechanism.

## Impact

Limiting VNC access to cluster workloads means users will need to access the machine using approved communication mechanisms.

## Audit Procedure

Verify to which users have the necessary permissions to create tokens:

```bash
$ oc get rolebinding -ojson | jq -c '.items[] | select(.roleRef.name | contains("token.kubevirt.io:generate"))'
```

## Remediation

Assign this RoleBinding only to users with approval to use it, otherwise remove unapproved users.

## Default Value

No default value, the command returns the list of rolebindings which has the roleName to generate the kubevirt token. If none was created then the command returns an `empty` list.

## References

- CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0, Section 1.12

## CIS Controls

| Controls Version | Control                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4 Secure Configuration of Enterprise Assets and Software | N    | N    | N    |
| v7               | 5.1 Establish Secure Configurations                      | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic           | Technique                      |
| ---------------- | ------------------------------ |
| Lateral Movement | T1021.005 Remote Services: VNC |
| Initial Access   | T1133 External Remote Services |

## Profile

- Level 1 - OpenShift Virtualization
