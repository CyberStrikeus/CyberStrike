---
name: cis-ocp-v160-4.1.2
description: "Ensure that the kubelet service file ownership is set to root:root (Automated)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, worker-nodes, worker-node-config-files]
cis_id: "4.1.2"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 4.1.2

## Profile Applicability
- **Level:** 1

## Description
Ensure that the kubelet service file ownership is set to `root:root`.

## Rationale
The kubelet service file controls various parameters that set the behavior of the kubelet service in the worker node. You should set its file ownership to maintain the integrity of the file. The file should be owned by `root:root`.

## Impact
None

## Audit Procedure
Run the following command to list the user and group for the `kubelet.service` file on each node:

```bash
for node in $(oc get nodes -o jsonpath='{.items[*].metadata.name}')
do
      oc debug node/${node} -- chroot /host stat -c %U:%G /etc/systemd/system/kubelet.service
done
```

Verify that the ownership is set to `root:root`.

## Remediation
None.

## Default Value
By default, OpenShift sets the default user and group for the `kubelet.service` file to `root:root`.

## References
1. https://docs.openshift.com/container-platform/4.5/architecture/control-plane.html#understanding-machine-config-operator_control-plane
2. https://docs.openshift.com/container-platform/4.5/scalability_and_performance/recommended-host-practices.html#create-a-kubeletconfig-crd-to-edit-kubelet-parameters_
3. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/
4. https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/#44-joining-your-nodes
5. https://kubernetes.io/docs/reference/setup-tools/kubeadm/#kubelet-drop-in

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | * | * | * |
| v7 | 4.3 Ensure the Use of Dedicated Administrative Accounts | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1083, T1222 | TA0005, TA0007 | M1026 |

## Profile
**Level 1** (Automated)
