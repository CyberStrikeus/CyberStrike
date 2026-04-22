---
name: cis-ocp-v190-4.1.1
description: "Ensure that the kubelet service file permissions are set to 644 or more restrictive (Automated)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, worker-nodes, worker-node-config-files]
cis_id: "4.1.1"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 4.1.1

## Profile Applicability
- **Level:** 1

## Description
Ensure that the kubelet service file has permissions of 644 or more restrictive.

## Rationale
The kubelet service file controls various parameters that set the behavior of the kubelet service in the worker node. You should restrict its file permissions to maintain the integrity of the file. The file should be writable by only the administrators on the system.

## Impact
None

## Audit Procedure
Kubelet is run as a `systemd` unit and its configuration file is created with `644` permissions.

Run the following command:

```bash
for node in $(oc get nodes -o jsonpath='{.items[*].metadata.name}')
  do
    oc debug -q node/${node} -- chroot /host stat -c %a /etc/systemd/system/kubelet.service
  done
```

OR

```bash
for node in $(oc get nodes -o jsonpath='{.items[*].metadata.name}')
  do
    oc debug -q node/${node} -- chroot /host stat -c %a /host/usr/lib/systemd/system/kubelet.service
  done
```

Note: It is possible to change the `oc debug` to `oc debug -q` in the above 2 statements to suppress or quiet the debug output.

Verify that the permissions are `644` or more restrictive.

## Remediation
None.

## Default Value
By default, the kubelet service file has permissions of `644`.

## References
1. https://docs.openshift.com/container-platform/4.5/architecture/control-plane.html#understanding-machine-config-operator_control-plane
2. https://docs.openshift.com/container-platform/4.5/scalability_and_performance/recommended-host-practices.html#create-a-kubeletconfig-crd-to-edit-kubelet-parameters_
3. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/
4. https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/#44-joining-your-nodes
5. https://kubernetes.io/docs/reference/setup-tools/kubeadm/#kubelet-drop-in

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | | * | * |
| v7 | 14.6 Protect Information through Access Control Lists | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1083, T1222 | TA0005, TA0007 | M1022 |

## Profile
**Level 1** (Automated)
