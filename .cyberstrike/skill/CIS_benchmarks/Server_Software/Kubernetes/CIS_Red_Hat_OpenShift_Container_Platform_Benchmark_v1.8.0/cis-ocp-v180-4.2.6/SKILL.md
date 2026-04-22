---
name: cis-ocp-v180-4.2.6
description: "Ensure that the --streaming-connection-idle-timeout argument is not set to 0 (Automated)"
category: cis-openshift
version: "1.8.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, worker-node, kubelet]
cis_id: "4.2.6"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.8.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.8.0 - Control 4.2.6

## Profile Applicability
- **Level:** 1

## Description
Do not disable timeouts on streaming connections.

## Rationale
Setting idle timeouts ensures that you are protected against Denial-of-Service attacks, inactive connections and running out of ephemeral ports.

**Note:** By default, `--streaming-connection-idle-timeout` is set to 4 hours which might be too high for your environment. Setting this as appropriate would additionally ensure that such streaming connections are timed out after serving legitimate use cases.

## Impact
Long-lived connections could be interrupted.

## Audit Procedure

OpenShift uses the kubernetes default of 4 hours for the streaming-connection-idle-timeout argument. Unless the cluster administrator has added the value to the node configuration, the default will be used. The value is a timeout for HTTP streaming sessions going through a kubelet, like the port-forward, exec, or attach pod operations. The `streaming-connection-idle-timeout` should not be disabled by setting it to `zero`, but it can be lowered. Note that if the value is set too low, then users using those features may experience a service interruption due to the timeout.

The kubelet configuration is currently serialized as an ignition configuration, so it can be directly edited. However, there is also a new `kubelet-config-controller` added to the Machine Config Controller (MCC). This allows you to create a `KubeletConfig` custom resource (CR) to edit the kubelet parameters.

Run the following command to view the streaming connection timeout for each node:

```bash
for node in $(oc get nodes -ojsonpath='{.items[*].metadata.name}'); do
oc get --raw /api/v1/nodes/$node/proxy/configz | jq
'.kubeletconfig.streamingConnectionIdleTimeout'
done
```

Verify the values returned for each node are not `0`.

## Remediation
Follow the instructions in the [documentation](https://docs.openshift.com/container-platform/latest/post_installation_configuration/machine-configuration-tasks.html#create-a-kubeletconfig-crd-to-edit-kubelet-parameters_post-install-machine-configuration-tasks) to create a `kubeletconfig` CRD and set the `streamingConnectionIdleTimeout` to the desired value. Do not set the value to `0`.

## Default Value
By default, `streamingConnectionIdleTimeout` is set to 4 hours.

## References
1. https://docs.openshift.com/container-platform/latest/architecture/control-plane.html#understanding-machine-config-operator_control-plane
2. https://docs.openshift.com/container-platform/latest/post_installation_configuration/machine-configuration-tasks.html#create-a-kubeletconfig-crd-to-edit-kubelet-parameters_post-install-machine-configuration-tasks
3. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/
4. https://github.com/kubernetes/kubernetes/pull/18552

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | * | * |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1190, T1210 | TA0001, TA0008 | M1025 |

## Profile
**Level 1** (Automated)
