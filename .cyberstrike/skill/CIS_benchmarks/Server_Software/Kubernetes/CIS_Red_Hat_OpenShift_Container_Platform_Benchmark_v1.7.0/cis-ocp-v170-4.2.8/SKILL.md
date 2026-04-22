---
name: cis-ocp-v170-4.2.8
description: "Ensure that the kubeAPIQPS [--event-qps] argument is set to 0 or a level which ensures appropriate event capture (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, worker-node, kubelet]
cis_id: "4.2.8"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 4.2.8

## Profile Applicability
- **Level:** 2

## Description
Security relevant information should be captured. The `--event-qps` flag on the Kubelet can be used to limit the rate at which events are gathered. Setting this too low could result in relevant events not being logged, however the unlimited setting of `0` could result in a denial of service on the kubelet.

## Rationale
It is important to capture all events and not restrict event creation. Events are an important source of security information and analytics that ensure that your environment is consistently monitored using the event data.

## Impact
Setting this parameter to `0` could result in a denial of service condition due to excessive events being created. The cluster's event processing and storage systems should be scaled to handle expected event loads.

## Audit Procedure

OpenShift uses the `kubeAPIQPS` argument and sets it to a default value of `50`. When this value is set to > 0, event creations per second are limited to the value set. If this value is set to `0`, event creations per second are unlimited.

Use the following command to validate the `kubeAPIQPS` configuration:

```bash
for node in $(oc get nodes -ojsonpath='{.items[*].metadata.name}'); do
  oc get --raw /api/v1/nodes/$node/proxy/configz | jq '.kubeletconfig.kubeAPIQPS'
done
```

Review the value set for the `kubeAPIQPS` argument and determine whether this has been set to an appropriate level for the cluster. If this value is set to `0`, event creations per second are unlimited.

## Remediation
None by default. Follow the [documentation](https://docs.openshift.com/container-platform/latest/post_installation_configuration/machine-configuration-tasks.html#create-a-kubeletconfig-crd-to-edit-kubelet-parameters_post-install-machine-configuration-tasks) to edit `kubeletconfig` parameters.

## Default Value
By default, the `kubeAPIQPS` argument is set to `50`.

## References
1. https://docs.openshift.com/container-platform/latest/architecture/control-plane.html#understanding-machine-config-operator_control-plane
2. https://docs.openshift.com/container-platform/latest/post_installation_configuration/machine-configuration-tasks.html#create-a-kubeletconfig-crd-to-edit-kubelet-parameters_post-install-machine-configuration-tasks
3. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/
4. https://github.com/kubernetes/kubernetes/blob/master/pkg/kubelet/apis/kubeletconfig/v1beta1/types.go

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.5 Collect Detailed Audit Logs | | * | * |
| v7 | 8.8 Enable Command-line Audit Logging | * | * | |

## MITRE ATT&CK Mappings

None specified.

## Profile
**Level 2** (Manual)
