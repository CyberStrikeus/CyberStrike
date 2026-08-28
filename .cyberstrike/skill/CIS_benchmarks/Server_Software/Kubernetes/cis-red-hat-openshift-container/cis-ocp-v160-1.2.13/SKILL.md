---
name: cis-ocp-v160-1.2.13
description: "Ensure that the admission control plugin NamespaceLifecycle is set (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server, namespace-lifecycle]
cis_id: "1.2.13"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 1.2.13

## Profile Applicability

- **Level:** 1

## Description

Reject creating objects in a namespace that is undergoing termination.

## Rationale

Setting admission control policy to `NamespaceLifecycle` ensures that objects cannot be created in non-existent namespaces, and that namespaces undergoing termination are not used for creating the new objects. This is recommended to enforce the integrity of the namespace termination process and also for the availability of the newer objects.

## Impact

None.

## Audit Procedure

OpenShift enables the `NamespaceLifecycle` plugin by default.

Use the following command to obtain a list of configured admission controllers:

```bash
oc -n openshift-kube-apiserver get configmap config -o json | jq -r '.data."config.yaml"' | jq '.apiServerArguments."enable-admission-plugins"'
```

Verify that `NamespaceLifecycle` is present in the returned list.

## Remediation

None.

## Default Value

OpenShift configures `NamespaceLifecycle` admission controller by default.

## References

1. https://docs.openshift.com/container-platform/latest/architecture/admission-plug-ins.html
2. https://github.com/openshift/cluster-kube-apiserver-operator/blob/release-4.6/bindata/v4.1.0/config/defaultconfig.yaml#L34-L78
3. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
4. https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/#namespacelifecycle

## CIS Controls

| Controls Version | Control                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.1 Establish and Maintain a Secure Configuration Process | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists     | x    | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1578                       | TA0005  | M1018       |

## Profile

**Level 1** (Manual)
