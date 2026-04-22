---
name: cis-ocp-v170-1.1.15
description: "Ensure that the Scheduler kubeconfig file permissions are set to 600 or more restrictive (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, master-node, config-files]
cis_id: "1.1.15"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 1.1.15

## Profile Applicability

- **Level:** 1

## Description

Ensure that the Scheduler `kubeconfig` file has permissions of `600` or more restrictive.

## Rationale

You should restrict the `kubeconfig` file permissions to maintain the integrity of the file. The file should be writable by only the administrators on the system.

## Impact

None.

## Audit Procedure

The `kubeconfig` file for `kube-scheduler` is stored in the ConfigMap `scheduler-kubeconfig` in the namespace `openshift-kube-scheduler`. The `kubeconfig` file is referenced in the pod via `hostpath` and is stored in `/etc/kubernetes/static-pod-resources/configmaps/scheduler-kubeconfig/kubeconfig` with permissions `600`.

Run the following command:

```bash
for i in $(oc get pods -n openshift-kube-scheduler -l app=openshift-kube-scheduler -o name)
 do
  oc exec -n openshift-kube-scheduler $i -- \
  stat -c %a /etc/kubernetes/static-pod-resources/configmaps/scheduler-kubeconfig/kubeconfig
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

1. https://docs.openshift.com/container-platform/latest/operators/operator-reference.html#cluster-kube-scheduler-operator_red-hat-operators
2. https://docs.openshift.com/container-platform/latest/nodes/scheduling/nodes-scheduler-about.html
3. https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/
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
