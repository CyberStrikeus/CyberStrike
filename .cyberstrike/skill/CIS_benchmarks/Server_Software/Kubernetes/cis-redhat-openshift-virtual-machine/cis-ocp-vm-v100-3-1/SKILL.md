---
name: cis-ocp-vm-v100-3-1
description: "Restrict access to cross datavolumes cloning (Manual)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, openshift-virtualization, kubevirt, vm, storage-components]
cis_id: "3.1"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 3.1 — Restrict access to cross datavolumes cloning

## Profile Applicability

- Level 1

## Description

Datavolume cross-namespace cloning allows cloning a `datavolume` from one namespace to another, breaking the namespace isolation.

## Rationale

Any user with access to multiple namespaces for the purpose of cloning a `datavolume` consequently has access to the underlying data of a volume they do not own.

## Impact

Limiting access to namespaces means cross namespace datavolume cloning will not be possible.

## Audit Procedure

To check which role bindings have the ability to clone across namespaces, use the following command where to list all the rolebinding and verify which one has a ClusterRole which enables it to operate on data volumes and have bound a service account in another namespace. Ensure that the destination namespace is a desired one.

```
$ oc get rolebinding -n <source-namespace> <allow-clone-to-user> -oyaml
```

Output will be in the following format:

```
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: <role-binding-name>
  namespace: <source namespace>
subjects:
- kind: ServiceAccount
  name: default
  namespace: <destination namespace>
roleRef:
  kind: ClusterRole
  name: <datavolume-cloner>
  apiGroup: rbac.authorization.k8s.io
```

Example:

```
$ oc get clusterRole datavolume-cloner -oyaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  annotations:
    kubectl.kubernetes.io/last-applied-configuration: |
      {"apiVersion":"rbac.authorization.k8s.io/v1","kind":"ClusterRole","metadata":{"annotations":{},"name":"datavolume-cloner"},"rules":[{"apiGroups":["cdi.kubevirt.io"],"resources":["datavolumes/source"],"verbs":["*"]}]}
  creationTimestamp: "2025-02-06T14:51:36Z"
  name: datavolume-cloner
  resourceVersion: "9267"
  uid: 4ad67fec-0461-4cbe-b460-a0fb5533be6d
rules:
- apiGroups:
  - cdi.kubevirt.io
  resources:
  - datavolumes/source
  verbs:
  - '*'
```

The clusterRole `datavolume-cloner` allows copying thedatavolume source. In the example, the command lists all the rolebindings in the source namespace and one of them enables the `default` service account in the namespace `dst-ns` to clone all the data volumes from the namespace `src-ns`.

## Remediation

Remove any `rolebinding` resources that grant unintended access across namespaces.

Please refer to the latest OpenShift documentation for details on this process.

## Default Value

Data volume cloning is limited to cluster administrators by default. Delegating the migration of data volumes across namespaces requires a cluster administrator to create new roles and role bindings for users who require that functionality for their job responsibilities.

## References

None listed in the PDF.

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | N    | Y    | Y    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic           | Technique                       |
| ---------------- | ------------------------------- |
| Collection       | T1530 - Data from Cloud Storage |
| Lateral Movement | T1021 - Remote Services         |

## Profile

- Level 1 - OpenShift Virtualization
