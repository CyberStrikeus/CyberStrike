---
name: cis-ocp-v180-1.1.16
description: "Ensure that the Scheduler kubeconfig file ownership is set to root:root (Manual)"
category: cis-openshift
version: "1.8.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, master-node, config-files]
cis_id: "1.1.16"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.8.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.8.0 - Control 1.1.16

## Profile Applicability

- **Level:** 1

## Description

Ensure that the `kubeconfig` file ownership is set to `root:root`.

## Rationale

You should set the `kubeconfig` file ownership to maintain the integrity of the file. The file should be owned by `root:root`.

## Impact

None.

## Audit Procedure

The `kubeconfig` file for `kube-scheduler` is stored in the ConfigMap `scheduler-kubeconfig` in the namespace `openshift-kube-scheduler`. The file `kubeconfig` is referenced in the pod via `hostpath` and is stored in `/etc/kubernetes/static-pod-resources/configmaps/scheduler-kubeconfig/kubeconfig` with ownership `root:root`.

Run the following command.

```bash
for i in $(oc get pods -n openshift-kube-scheduler -l app=openshift-kube-scheduler -o name)
  do
  oc exec -n openshift-kube-scheduler $i -- \
  stat -c %U:%G /etc/kubernetes/static-pod-resources/configmaps/scheduler-kubeconfig/kubeconfig
  done
```

Verify that the ownership is set to `root:root`.

## Remediation

No remediation required; file permissions are managed by the operator.

## Default Value

By default, `scheduler-kubeconfig/kubeconfig` file ownership is set to `root:root`.

## References

1. https://docs.openshift.com/container-platform/latest/operators/operator-reference.html#cluster-kube-scheduler-operator_red-hat-operators
2. https://docs.openshift.com/container-platform/latest/nodes/scheduling/nodes-scheduler-about.html
3. https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | \*   | \*   | \*   |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts                   | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1083, T1222                | TA0005, TA0007 | M1026       |

## Profile

**Level 1** (Manual)
