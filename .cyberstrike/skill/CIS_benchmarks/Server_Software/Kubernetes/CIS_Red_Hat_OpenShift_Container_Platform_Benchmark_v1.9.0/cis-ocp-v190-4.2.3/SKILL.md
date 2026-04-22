---
name: cis-ocp-v190-4.2.3
description: "Ensure that the --authorization-mode argument is not set to AlwaysAllow (Automated)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, worker-nodes, kubelet]
cis_id: "4.2.3"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 4.2.3

## Profile Applicability
- **Level:** 1

## Description
Do not allow all requests. Enable explicit authorization.

## Rationale
Kubelets, by default, allow all authenticated requests (even anonymous ones) without needing explicit authorization checks from the apiserver. You should restrict this behavior and only allow explicitly authorized requests.

## Impact
Unauthorized requests will be denied.

## Audit Procedure
In OpenShift 4, the Kubernetes configuration file is managed by the Machine Config Operator. By default, OpenShift rejects unauthenticated and unauthorized users.

You can verify that each node in the cluster is configured to only accept authenticated users with the following command:

```bash
for node in $(oc get nodes -ojsonpath='{.items[*].metadata.name}'); do
  oc get --raw /api/v1/nodes/$node/proxy/configz | jq '.kubeletconfig.authorization.mode';
done
```

Verify none of the nodes return `AlwaysAllow` for the authorization mode.

## Remediation
None.

## Default Value
By default, OpenShift uses `Webhook` authorization.

## References
1. https://docs.openshift.com/container-platform/4.5/architecture/control-plane.html#understanding-machine-config-operator_control-plane
2. https://docs.openshift.com/container-platform/4.5/scalability_and_performance/recommended-host-practices.html#create-a-kubeletconfig-crd-to-edit-kubelet-parameters_
3. https://github.com/openshift/machine-config-operator/blob/release-4.5/docs/KubeletConfigDesign.md
4. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/
5. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet-authentication-authorization/#kubelet-authentication

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | * | * | * |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|

## Profile
**Level 1** (Automated)
