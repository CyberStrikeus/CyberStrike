---
name: cis-ocp-v170-1.1.4
description: "Ensure that the controller manager pod specification file ownership is set to root:root (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, master-node, config-files]
cis_id: "1.1.4"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 1.1.4

## Profile Applicability

- **Level:** 1

## Description

Ensure that the controller manager pod specification file ownership is set to `root:root`.

## Rationale

The controller manager pod specification file controls various parameters that set the behavior of various components of the master node. You should set its file ownership to maintain the integrity of the file. The file should be owned by `root:root`.

## Impact

None

## Audit Procedure

OpenShift 4 deploys two controller managers: the OpenShift Controller manager and the Kube Controller manager.
The OpenShift Controller manager is managed as a deployment. The pod specification yaml for openshift-controller-manager is stored in etcd.
The Kube Controller manager is managed as a static pod. The pod specification file for the openshift-kube-controller-manager is created on control plane nodes at /etc/kubernetes/manifests/kube-controller-manager-pod.yaml. It is mounted via hostpath to the kube-controller-manager pods via /etc/kubernetes/static-pod-resources/kube-controller-manager-pod.yaml with ownership root:root.

Run the following command.

```bash
#echo "openshift-kube-controller-manager pod specification file ownership"

for i in $( oc get pods -n openshift-kube-controller-manager -o name -l app=kube-controller-manager)
do
  oc exec  -n openshift-kube-controller-manager $i -- \
  stat -c %U:%G /etc/kubernetes/static-pod-resources/kube-controller-manager-pod.yaml
done
```

Verify that the ownership is set to `root:root`.

## Remediation

No remediation required; file permissions are managed by the operator.

## Default Value

By default, in OpenShift 4, the `kube-controller-manager-pod.yaml` file ownership is set to `root:root`.

## References

1. https://docs.openshift.com/container-platform/latest/architecture/control-plane.html#defining-masters_control-plane
2. https://docs.openshift.com/container-platform/latest/operators/operator-reference.html#cluster-openshift-controller-manager-operator_red-hat-operators
3. https://docs.openshift.com/container-platform/latest/operators/operator-reference.html#kube-controller-manager-operator_red-hat-operators
4. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/

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
