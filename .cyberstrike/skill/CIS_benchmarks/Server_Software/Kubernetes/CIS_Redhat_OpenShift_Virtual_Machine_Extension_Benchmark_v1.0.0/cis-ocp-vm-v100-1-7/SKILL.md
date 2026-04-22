---
name: cis-ocp-vm-v100-1-7
description: "Ensure KSM is disabled (Automated)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, openshift-virtualization, kubevirt, vm, platform-configuration, ksm, kernel-samepage-merging, memory]
cis_id: "1.7"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.7 — Ensure KSM is disabled

## Profile Applicability
- Level 2

## Description
Kernel Samepage Merging (KSM) is a Linux kernel feature that merges identical memory pages across virtual machines running on a single host, potentially reducing memory usage and improving system performance.

## Rationale
Sharing resources introduces the risk of memory corruption attacks, unauthorized or unintended sharing of information, and the manipulation of data flow restrictions.

## Impact
Disabling Kernel Samepage Merging (KSM) does not impact normal node operations. Workloads requiring a high amount of memory usage could potentially see an impact on system performance.

## Audit Procedure
Use the following command to list KSM configuration for hyperconverged resources:

```bash
$ oc get hyperconvergeds kubevirt-hyperconverged -n openshift-cnv -ojsonpath='{.spec.ksmConfiguration}'
```

## Remediation
Disable the KSM feature. For example, by directly editing the object with `oc edit hyperconverged kubevirt-hyperconverged -n openshift-cnv` and set the field to `false`.

## Default Value
KSM is disabled by default. The command should return `false`.

## References
- CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0, Section 1.7

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | N | Y | Y |
| v7 | 9.1 Associate Active Ports, Services and Protocols to Asset Inventory | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Credential Access | T1212 Exploitation for Credential Access |
| Collection | T1005 Data from Local System |

## Profile
- Level 2 - OpenShift Virtualization
