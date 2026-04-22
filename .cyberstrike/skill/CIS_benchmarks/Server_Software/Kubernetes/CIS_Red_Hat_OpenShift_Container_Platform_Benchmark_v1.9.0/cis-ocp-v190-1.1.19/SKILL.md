---
name: cis-ocp-v190-1.1.19
description: "Ensure that the OpenShift PKI directory and file ownership is set to root:root (Manual)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, master-node-config-files, pki, certificates, file-ownership]
cis_id: "1.1.19"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 1.1.19

## Profile Applicability
- **Level:** 1

## Description
Ensure that the OpenShift PKI directory and file ownership is set to `root:root`.

## Rationale
OpenShift makes use of a number of certificates as part of its operation. You should verify the ownership of the directory containing the PKI information and all files in that directory to maintain their integrity. The directory and files should be owned by `root:root`.

## Impact
None

## Audit Procedure
Keys for control plane components deployed as static pods, `kube-apiserver`, `kube-controller-manager`, and `openshift-kube-scheduler` are stored in the directory `/etc/kubernetes/static-pod-certs/secrets`. The directory and file ownership are set to `root:root`.

Run the following command.

```bash
# Should return root:root for all files and directories

for i in $(oc -n openshift-kube-apiserver get pod -l app=openshift-kube-apiserver -o jsonpath='{.items[*].metadata.name}')
do
      echo $i static-pod-certs
      oc exec -n openshift-kube-apiserver $i -c kube-apiserver -- \
      find /etc/kubernetes/static-pod-certs -type d -wholename '*/secrets*' -exec stat -c %U:%G {} \;
      oc exec -n openshift-kube-apiserver $i -c kube-apiserver -- \
      find /etc/kubernetes/static-pod-certs -type f -wholename '*/secrets*' -exec stat -c %U:%G {} \;
      echo $i static-pod-resources
      oc exec -n openshift-kube-apiserver $i -c kube-apiserver -- \
      find /etc/kubernetes/static-pod-resources -type d -wholename '*/secrets*' -exec stat -c %U:%G {} \;
      oc exec -n openshift-kube-apiserver $i -c kube-apiserver -- \
      find /etc/kubernetes/static-pod-resources -type f -wholename '*/secrets*' -exec stat -c %U:%G {} \;
done
```

Verify that the ownership of all files and directories in this hierarchy is set to `root:root`.

## Remediation
No remediation required; file permissions are managed by the operator.

## Default Value
By default, the `static-pod-resources/secrets` and `static-pod-certs` directories and all of the files and directories contained within it, are set to be owned by the root user.

## References
1. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | * | * | * |
| v7 | 4.3 Ensure the Use of Dedicated Administrative Accounts | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1083, T1222 | TA0005, TA0007 | M1022 |

## Profile
**Level 1** (Manual)
