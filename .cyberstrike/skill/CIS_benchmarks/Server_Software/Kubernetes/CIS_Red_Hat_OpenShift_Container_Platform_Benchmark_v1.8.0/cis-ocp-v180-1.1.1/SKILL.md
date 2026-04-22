---
name: cis-ocp-v180-1.1.1
description: "Ensure that the API server pod specification file permissions are set to 600 or more restrictive (Manual)"
category: cis-openshift
version: "1.8.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, master-node, config-files]
cis_id: "1.1.1"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.8.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.8.0 - Control 1.1.1

## Profile Applicability
- **Level:** 1

## Description
Ensure that the API server pod specification file has permissions of `600` or more restrictive.

## Rationale
The API server pod specification file controls various parameters that set the behavior of the API server. You should restrict its file permissions to maintain the integrity of the file. The file should be writable only by the administrators on the system.

## Impact
None.

## Audit Procedure
OpenShift 4 deploys two API servers: the OpenShift API server and the Kube API server. The OpenShift API server delegates requests for Kubernetes objects to the Kube API server.
The OpenShift API server is managed as a deployment. The pod specification yaml for openshift-apiserver is stored in etcd.
The Kube API Server is managed as a static pod. The pod specification file for the kube-apiserver is created on the control plane nodes at /etc/kubernetes/manifests/kube-apiserver-pod.yaml. The kube-apiserver is mounted via hostpath to the kube-apiserver pods via /etc/kubernetes/static-pod-resources/kube-apiserver-pod.yaml with permissions `600`.

To verify pod specification file permissions for the kube-apiserver, run the following command.

```bash
for i in $( oc get pods -n openshift-kube-apiserver -l app=openshift-kube-apiserver -o name )
do
  oc exec  -n openshift-kube-apiserver $i -- \
  stat -c %a  /etc/kubernetes/static-pod-resources/kube-apiserver-pod.yaml
done
```

Verify that the permissions are `600` or more restrictive.

## Remediation
There is no remediation for updating the permissions of `kube-apiserver-pod.yaml`. The file is owned by an OpenShift operator and any changes to the file will result in a degraded cluster state.
Please do not attempt to remediate the permissions of this file.

## Default Value
By default, in OpenShift 4.14, the `kube-apiserver-pod.yaml` has permissions of `600`.

In older versions of OpenShift, the `kube-apiserver-pod.yaml` has permissions of `644`, and is not remediable. Please upgrade to OpenShift 4.14 when possible.

## References
1. https://docs.openshift.com/container-platform/latest/architecture/control-plane.html#defining-masters_control-plane
2. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
3. https://github.com/openshift/library-go/commit/19a42d2bae8ba68761cfad72bf764e10d275ad6e

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | * | * | * |
| v7 | 14.6 Protect Information through Access Control Lists | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1083, T1222 | TA0005, TA0007 | M1022 |

## Profile
**Level 1** (Manual)
