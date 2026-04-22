---
name: cis-ocp-v170-1.1.3
description: "Ensure that the controller manager pod specification file permissions are set to 600 or more restrictive (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, master-node, config-files]
cis_id: "1.1.3"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 1.1.3

## Profile Applicability

- **Level:** 1

## Description

Ensure that the controller manager pod specification file has permissions of `600` or more restrictive.

## Rationale

The controller manager pod specification file controls various parameters that set the behavior of the Controller Manager on the master node. You should restrict its file permissions to maintain the integrity of the file. The file should be writable by only the administrators on the system.

## Impact

None.

## Audit Procedure

OpenShift 4 deploys two controller managers: the OpenShift Controller manager and the Kube Controller manager.
The OpenShift Controller manager is managed as a deployment. The pod specification yaml for openshift-controller-manager is stored in etcd.
The Kube Controller manager is managed as a static pod. The pod specification file for the openshift-kube-controller-manager is created on control plane nodes at /etc/kubernetes/manifests/kube-controller-manager-pod.yaml. It is mounted via hostpath to the kube-controller-manager pods via /etc/kubernetes/static-pod-resources/kube-controller-manager-pod.yaml with permissions 0644.

To verify pod specification file permissions for the kube-controller-manager, run the following command.

```bash
for i in $( oc get pods -n openshift-kube-controller-manager -o name -l app=kube-controller-manager)
do
  oc exec  -n openshift-kube-controller-manager $i -- \
  stat -c %a /etc/kubernetes/static-pod-resources/kube-controller-manager-pod.yaml
done
```

Verify that the permissions are `600` or more restrictive.

## Remediation

There is no remediation for updating the permissions of `kube-controller-manager-pod.yaml`. The file is owned by an OpenShift operator and any changes to the file will result in a degraded cluster state.
Please do not attempt to remediate the permissions of this file.

## Default Value

By default, in OpenShift 4.14, the `kube-controller-manager-pod.yaml` has permissions of `600`.

In older versions of OpenShift, the `kube-controller-manager-pod.yaml` has permissions of `644`, and it not remediable. Please upgrade to OpenShift 4.14 when possible.

## References

1. https://docs.openshift.com/container-platform/latest/architecture/control-plane.html#defining-masters_control-plane
2. https://github.com/openshift/library-go/commit/19a42d2bae8ba68761cfad72bf764e10d275ad6e
3. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | \*   | \*   | \*   |
| v7               | 14.6 Protect Information through Access Control Lists | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1083, T1222                | TA0005, TA0007 | M1022       |

## Profile

**Level 1** (Manual)
