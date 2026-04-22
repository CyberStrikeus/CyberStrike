---
name: cis-ocp-v170-1.2.15
description: "Ensure that the admission control plugin NodeRestriction is set (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server]
cis_id: "1.2.15"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 1.2.15

## Profile Applicability

- **Level:** 1

## Description

Limit the `Node` and `Pod` objects that a kubelet could modify.

## Rationale

Using the `NodeRestriction` plug-in ensures that the kubelet is restricted to the `Node` and `Pod` objects that it could modify as defined. Such kubelets will only be allowed to modify their own `Node` API object, and only modify `Pod` API objects that are bound to their node.

## Impact

None.

## Audit Procedure

In OpenShift, the `NodeRestriction` admission plugin is enabled by default.

Use the following command to obtain a list of configured admission controllers:

```bash
oc -n openshift-kube-apiserver get configmap config -o json | jq -r '.data."config.yaml"' | jq '.apiServerArguments."enable-admission-plugins"'
```

Verify the list includes `NodeRestriction`.

## Remediation

None.

## Default Value

In OpenShift, the `NodeRestriction` admission plugin is enabled by default and cannot be disabled.

## References

1. https://docs.openshift.com/container-platform/latest/architecture/admission-plug-ins.html
2. https://github.com/openshift/origin/blob/release-4.5/vendor/k8s.io/kubernetes/cmd/kubeadm/app/phases/controlplane/manifests.go#L132

## CIS Controls

| Controls Version | Control                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.11 Leverage Vetted Modules or Services for Application Security Components |      | \*   | \*   |
| v7               | 9.4 Apply Host-based Firewalls or Port Filtering                              | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1609, T1610                | TA0002  | M1038       |

## Profile

**Level 1** (Manual)
