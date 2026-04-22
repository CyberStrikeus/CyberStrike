---
name: cis-ocp-vm-v100-1-2
description: "Enable nonRoot feature gate in OCPvirt prior to 4.18 (Automated)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, openshift-virtualization, kubevirt, vm, platform-configuration, feature-gate, nonroot, privilege]
cis_id: "1.2"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.2 — Enable nonRoot feature gate in OCPvirt prior to 4.18

## Profile Applicability
- Level 1

## Description
Root is a default account with elevated privileges, including full administrative access to both security and non-security related functions. The "nonRoot" feature gate in OpenShift environments ensures virtual machine access is restricted to resources and functionality required to operate.

## Rationale
Unauthorized access to a root account without restrictions implemented by the nonRoot feature introduces the risk of unintended or unauthorized access to privilege elevation and the ability to perform administrative tasks. This feature is a foundational mechanism in implementing role and attribute based access controls.

## Impact
Disabling root introduces the need to implement alternate identification and authentication methods to access administrative functions.

## Audit Procedure
Use the following command to list nonRoot settings for hyper converged resources:

```bash
$ oc get hyperconverged kubevirt-hyperconverged -n openshift-cnv -ojsonpath='{.spec.featureGates.nonRoot}'
```

Verify the output is `true`. nonRoot is deprecated in Openshift Virtualization from 4.18, and the secure default is enforced.

## Remediation
Enable `nonRoot` and set its value to `True`.

```bash
$ oc patch hyperconverged kubevirt-hyperconverged -n openshift-cnv --type='json' -p='[
    {"op": "replace", "path": "/spec/featureGates/nonRoot", "value": true },
]'
```

## Default Value
By default, KubeVirt workloads run in nonRoot mode and it sets to `false`. From 4.18, this field will be ignored, and always be enabled.

## References
- CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0, Section 1.2

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process | Y | Y | Y |
| v7 | 5.1 Establish Secure Configurations | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Privilege Escalation | T1068 Exploitation for Privilege Escalation |
| Defense Evasion | T1548 Abuse Elevation Control Mechanism |

## Profile
- Level 1 - OpenShift Virtualization
