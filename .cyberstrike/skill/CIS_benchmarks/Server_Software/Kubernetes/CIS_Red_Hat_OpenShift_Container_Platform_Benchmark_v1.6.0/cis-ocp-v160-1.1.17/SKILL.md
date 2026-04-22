---
name: cis-ocp-v160-1.1.17
description: "Ensure that the Controller Manager kubeconfig file permissions are set to 600 or more restrictive (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags:
  [
    cis,
    openshift,
    kubernetes,
    redhat,
    control-plane,
    master-node-config-files,
    controller-manager,
    kubeconfig,
    file-permissions,
  ]
cis_id: "1.1.17"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 1.1.17

## Profile Applicability

- **Level:** 1

## Description

Ensure that the `kubeconfig` file mounted into the Controller Manager has permissions of `600` or more restrictive.

## Rationale

You should restrict the `kubeconfig` file permissions to maintain the integrity of the file. The file should be writable by only the administrators on the system.

## Impact

None.

## Audit Procedure

The `kubeconfig` file for `kube-controller-manager` is stored in the ConfigMap `controller-manager-kubeconfig` in the namespace `openshift-kube-controller-manager`. The `kubeconfig` file is referenced in the pod via `hostpath` and is stored in `/etc/kubernetes/static-pod-resources/configmaps/controller-manager-kubeconfig/kubeconfig` with permissions `600`.
Run the following command.

```bash
for i in $(oc get pods -n openshift-kube-controller-manager -l app=kube-controller-manager -oname)
 do
  oc exec -n openshift-kube-controller-manager $i -- \
  stat -c %a /etc/kubernetes/static-pod-resources/configmaps/controller-manager-kubeconfig/kubeconfig
 done
```

Verify that the permissions are `600` or more restrictive.

## Remediation

There is no remediation for updating the permissions of the `kubeconfig` file. The file is owned by an OpenShift operator and any changes to the file will result in a degraded cluster state.
Please do not attempt to remediate the permissions of this file.

## Default Value

By default, in OpenShift 4.14, the `kubeconfig` has permissions of `600`.

In older versions of OpenShift, the `kubeconfig` has permissions of `644`, and is not remediable. Please upgrade to OpenShift 4.14 when possible.

## References

1. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#kube-controller-manager-operator_red-hat-operators
2. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#cluster-openshift-controller-manager-operator_red-hat-operators
3. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/
4. https://issues.redhat.com//browse/OCPBUGS-14323

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
