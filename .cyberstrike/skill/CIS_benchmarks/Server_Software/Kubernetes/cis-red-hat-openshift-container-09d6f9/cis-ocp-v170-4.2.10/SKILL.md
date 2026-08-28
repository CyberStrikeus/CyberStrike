---
name: cis-ocp-v170-4.2.10
description: "Ensure that the --rotate-certificates argument is not set to false (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, worker-node, kubelet]
cis_id: "4.2.10"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 4.2.10

## Profile Applicability

- **Level:** 2

## Description

Enable kubelet client certificate rotation.

## Rationale

The `--rotate-certificates` setting causes the kubelet to rotate its client certificates by creating new CSRs as its existing credentials expire. This automated periodic rotation ensures that the there is no downtime due to expired certificates and thus addressing availability in the CIA security triad.

Note: This recommendation only applies if you let kubelets get their certificates from the API server. In case your kubelet certificates come from an outside authority/tool (e.g. Vault) then you need to take care of rotation yourself.

## Impact

None.

## Audit Procedure

This feature also requires the `RotateKubeletClientCertificate` feature gate to be enabled. The feature gate is enabled by default.

Run the following command to check that certificate rotation is enabled for each node:

```bash
for node in $(oc get nodes -ojsonpath='{.items[*].metadata.name}'); do
  oc get --raw /api/v1/nodes/$node/proxy/configz | jq '.kubeletconfig.rotateCertificates'
done
```

Verify all the nodes return `true`.

## Remediation

None.

## Default Value

By default, in OpenShift 4, kubelet client certificate rotation is enabled.

## References

1. https://docs.openshift.com/container-platform/latest/architecture/control-plane.html#understanding-machine-config-operator_control-plane
2. https://github.com/openshift/kubernetes-kubelet/blob/origin-4.5-kubernetes-1.18.3/config/v1beta1/types.go#L172-L181
3. https://github.com/openshift/machine-config-operator/blob/release-4.5/templates/master/01-master-kubelet/_base/files/kubelet.yaml
4. https://github.com/openshift/machine-config-operator/blob/release-4.5/templates/worker/01-worker-kubelet/_base/files/kubelet.yaml
5. https://github.com/kubernetes/kubernetes/pull/41912
6. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet-tls-bootstrapping/#kubelet-configuration
7. https://kubernetes.io/docs/imported/release/notes/
8. https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | \*   | \*   |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | \*   | \*   |

## MITRE ATT&CK Mappings

None specified.

## Profile

**Level 2** (Manual)
