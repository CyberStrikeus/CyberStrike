---
name: cis-ocp-v170-4.2.5
description: "Verify that the read only port is not used or is set to 0 (Automated)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, worker-node, kubelet]
cis_id: "4.2.5"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 4.2.5

## Profile Applicability
- **Level:** 1

## Description
Disable the read-only port.

## Rationale
The Kubelet process provides a read-only API in addition to the main Kubelet API. Unauthenticated access is provided to this read-only API which could possibly retrieve potentially sensitive information about the cluster.

## Impact
Removal of the read-only port will require that any service which made use of it will need to be re-configured to use the main Kubelet API.

## Audit Procedure

In OpenShift 4, the kubelet is managed by the Machine Config Operator. The kubelet config file is found at `/etc/kubernetes/kubelet.conf`. OpenShift disables the read-only port (10255) on all nodes by setting the `read-only-port` kubelet flag to 0 by default in OpenShift 4.6 and above.

Run the following command to verify the `kubelet-read-only-port` is set to `0` for the Kubernetes API server configuration map:

```bash
oc -n openshift-kube-apiserver get cm config -o json | jq -r '.data."config.yaml"' | yq '.apiServerArguments."kubelet-read-only-port"'
```

Verify the output is a list that contains `0`, like the following:

```json
[
  "0"
]
```

## Remediation
In earlier versions of OpenShift 4, the `read-only-port` argument is not used. Follow the instructions in the [documentation](https://docs.openshift.com/container-platform/latest/post_installation_configuration/machine-configuration-tasks.html#create-a-kubeletconfig-crd-to-edit-kubelet-parameters_post-install-machine-configuration-tasks) to create a `kubeletconfig` CRD and set the `kubelet-read-only-port` is set to `0`.

## Default Value
By default, in OpenShift 4.5 and earlier, the `--read-only-port` is not used. In OpenShift 4.6 and above, the `kubelet-read-only-port` is set to `0`.

## References
1. https://docs.openshift.com/container-platform/latest/architecture/control-plane.html#understanding-machine-config-operator_control-plane
2. https://docs.openshift.com/container-platform/latest/post_installation_configuration/machine-configuration-tasks.html#create-a-kubeletconfig-crd-to-edit-kubelet-parameters_post-install-machine-configuration-tasks
3. https://github.com/openshift/kubernetes-kubelet/blob/origin-4.5-kubernetes-1.18.3/config/v1beta1/types.go#L135-L141
4. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | * | * |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | * | * |

## MITRE ATT&CK Mappings

None specified.

## Profile
**Level 1** (Automated)
