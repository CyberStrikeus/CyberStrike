---
name: cis-ocp-v160-4.2.2
description: "Ensure that the --anonymous-auth argument is set to false (Automated)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, worker-nodes, kubelet]
cis_id: "4.2.2"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 4.2.2

## Profile Applicability

- **Level:** 1

## Description

Disable anonymous requests to the Kubelet server.

## Rationale

When enabled, requests that are not rejected by other configured authentication methods are treated as anonymous requests. These requests are then served by the Kubelet server. You should rely on authentication to authorize access and disallow anonymous requests.

## Impact

Anonymous requests will be rejected.

## Audit Procedure

In OpenShift 4, the Kubernetes configuration file is managed by the Machine Config Operator and `anonymous-auth` is set to `false` by default.
Run the following command on each node to the configuration of anonymous authentication:

```bash
for node in $(oc get nodes -ojsonpath='{.items[*].metadata.name}'); do
oc get --raw /api/v1/nodes/$node/proxy/configz | jq '.kubeletconfig.authentication.anonymous.enabled'
done
```

Verify that the configuration for each node returns `false`.

## Remediation

Create a `kubeletconfig` to explicitly disable anonymous authentication. Examples of how to do this can be found in the OpenShift documentation.

## Default Value

By default, anonymous access is set to `false`.

## References

1. https://docs.openshift.com/container-platform/latest/architecture/control-plane.html#understanding-machine-config-operator_control-plane
2. https://docs.openshift.com/container-platform/latest/post_installation_configuration/machine-configuration-tasks.html#create-a-kubeletconfig-crd-to-edit-kubelet-parameters_post-install-machine-configuration-tasks
3. https://github.com/openshift/machine-config-operator/blob/release-4.5/docs/KubeletConfigDesign.md
4. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/
5. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet-authentication-authorization/#kubelet-authentication

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | \*   | \*   | \*   |
| v7               | 14.6 Protect Information through Access Control Lists | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| N/A                         | N/A     | N/A         |

## Profile

**Level 1** (Automated)
