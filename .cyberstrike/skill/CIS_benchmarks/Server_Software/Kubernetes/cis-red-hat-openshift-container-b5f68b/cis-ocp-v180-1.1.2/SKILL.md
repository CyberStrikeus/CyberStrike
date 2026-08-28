---
name: cis-ocp-v180-1.1.2
description: "Ensure that the API server pod specification file ownership is set to root:root (Manual)"
category: cis-openshift
version: "1.8.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, master-node, config-files]
cis_id: "1.1.2"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.8.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.8.0 - Control 1.1.2

## Profile Applicability

- **Level:** 1

## Description

Ensure that the API server pod specification file ownership is set to `root:root`.

## Rationale

The API server pod specification file controls various parameters that set the behavior of the API server. You should set its file ownership to maintain the integrity of the file. The file should be owned by `root:root`.

## Impact

None

## Audit Procedure

OpenShift 4 deploys two API servers: the OpenShift API server and the Kube API server.
The OpenShift API server is managed as a deployment. The pod specification yaml for openshift-apiserver is stored in etcd.
The Kube API Server is managed as a static pod. The pod specification file for the kube-apiserver is created on the control plane nodes at /etc/kubernetes/manifests/kube-apiserver-pod.yaml. The kube-apiserver is mounted via hostpath to the kube-apiserver pods via /etc/kubernetes/static-pod-resources/kube-apiserver-pod.yaml with ownership `root:root`.

To verify pod specification file ownership for the kube-apiserver, run the following command.

```bash
#echo "check kube-apiserver pod specification file ownership"

for i in $( oc get pods -n openshift-kube-apiserver -l app=openshift-kube-apiserver -o name )
do
  oc exec  -n openshift-kube-apiserver $i -- \
  stat -c %U:%G  /etc/kubernetes/static-pod-resources/kube-apiserver-pod.yaml
done
```

Verify that the ownership is set to `root:root`.

## Remediation

No remediation required; file permissions are managed by the operator.

## Default Value

By default, in OpenShift 4, the kube-apiserver-pod.yaml file ownership is set to `root:root`.

## References

1. https://docs.openshift.com/container-platform/latest/architecture/control-plane.html#defining-masters_control-plane
2. https://docs.openshift.com/container-platform/latest/operators/operator-reference.html#kube-apiserver-operator_red-hat-operators
3. https://docs.openshift.com/container-platform/latest/operators/operator-reference.html#openshift-apiserver-operator_red-hat-operators
4. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/

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
