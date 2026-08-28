---
name: cis-ocp-v180-1.1.21
description: "Ensure that the OpenShift PKI key file permissions are set to 600 (Manual)"
category: cis-openshift
version: "1.8.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, master-node, config-files]
cis_id: "1.1.21"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.8.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.8.0 - Control 1.1.21

## Profile Applicability

- **Level:** 1

## Description

Ensure that the OpenShift PKI key files have permissions of `600`.

## Rationale

OpenShift makes use of a number of key files as part of the operation of its components. The permissions on these files should be set to `600` to protect their integrity and confidentiality.

## Impact

None

## Audit Procedure

Keys for control plane components like `kube-apiserver`, `kube-controller-manager`, `kube-scheduler` and `etcd` are stored with their respective static pod configurations in the directory `/etc/kubernetes/static-pod-certs/secrets`. Key files all have permissions `600`.

Run the following command.

```bash
for i in $(oc -n openshift-kube-apiserver get pod -l app=openshift-kube-apiserver -o jsonpath='{.items[*].metadata.name}')
do
    echo $i static-pod-certs
    oc exec -n openshift-kube-apiserver $i -c kube-apiserver -- \
    find /etc/kubernetes/static-pod-certs -type f -wholename '*/secrets/*.key' -exec stat -c %a {} \;
done
```

Verify that the permissions are `600`.

## Remediation

No remediation required; file permissions are managed by the operator.

## Default Value

By default, the keys used by OpenShift are set to have permissions of `600`.

## References

1. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/

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
