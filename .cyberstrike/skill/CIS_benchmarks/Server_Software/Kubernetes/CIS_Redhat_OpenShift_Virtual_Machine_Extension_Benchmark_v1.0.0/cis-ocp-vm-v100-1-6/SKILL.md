---
name: cis-ocp-vm-v100-1-6
description: "Restrict patching operations in the annotations for Hyperconverged (Manual)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags:
  [
    cis,
    openshift,
    kubernetes,
    openshift-virtualization,
    kubevirt,
    vm,
    platform-configuration,
    hco,
    annotations,
    jsonpatch,
  ]
cis_id: "1.6"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.6 — Restrict patching operations in the annotations for Hyperconverged

## Profile Applicability

- Level 1

## Description

The kubevirt-hyperconverged (HCO) object provides a mechanism to customize OpenShift Virtualization components through the control of patching operations. Although this approach itself does not inherently introduce security risks, enabling experimental features may have unintended consequences and might not be officially supported. It is essential to weigh the benefits of using these options against any potential security implications before proceeding.

## Rationale

Cloud administrators should not patch OpenShift Virtualization objects, but rather configure the OpenShift Virtualization options available in HCO.

## Impact

Restrictions to patching operations may prevent the use of experimental features not yet supported or considered insecure.

## Audit Procedure

Ensure there are no patching operations for the Openshift Virtualization component:

```bash
$ oc get hyperconverged kubevirt-hyperconverged -n openshift-cnv -o jsonpath='{.metadata.annotations}'| jq '.|has("kubevirt.kubevirt.io/jsonpatch")'

$ oc get hyperconverged kubevirt-hyperconverged -n openshift-cnv -o jsonpath='{.metadata.annotations}'| jq '.|has("containerizeddataimporter.kubevirt.io/jsonpatch")'

$ oc get hyperconverged kubevirt-hyperconverged -n openshift-cnv -o jsonpath='{.metadata.annotations}'| jq '.|has("networkaddonsconfigs.kubevirt.io/jsonpatch")'

$ oc get hyperconverged kubevirt-hyperconverged -n openshift-cnv -o jsonpath='{.metadata.annotations}'| jq '.|has("ssp.kubevirt.io/jsonpatch")'
```

All the commands should return `an empty string`.

## Remediation

The annotations should be removed from the Hyperconverged. For example, by directly editing the object with `oc edit hyperconverged kubevirt-hyperconverged -n openshift-cnv` or by removing the annotation with the `annotate` command. Example:

```bash
$ oc annotate --overwrite -n openshift-cnv hco kubevirt-hyperconverged 'containerizeddataimporter.kubevirt.io/jsonpatch-'
```

## Default Value

None of the annotations should be set and the result of the commands should always be `false`.

## References

- CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0, Section 1.6

## CIS Controls

| Controls Version | Control                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.6 Securely Manage Enterprise Assets and Software | Y    | Y    | Y    |
| v7               | 5.1 Establish Secure Configurations                | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic          | Technique                  |
| --------------- | -------------------------- |
| Defense Evasion | T1562 Impair Defenses      |
| Persistence     | T1098 Account Manipulation |

## Profile

- Level 1 - OpenShift Virtualization
