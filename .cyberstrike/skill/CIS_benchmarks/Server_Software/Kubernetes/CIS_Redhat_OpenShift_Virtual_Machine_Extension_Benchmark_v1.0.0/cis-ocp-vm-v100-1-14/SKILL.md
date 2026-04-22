---
name: cis-ocp-vm-v100-1-14
description: "Restrict update access to the CDI CR (Manual)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, openshift-virtualization, kubevirt, vm, platform-configuration, rbac, cdi, containerized-data-importer]
cis_id: "1.14"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.14 — Restrict update access to the CDI CR

## Profile Applicability
- Level 1

## Description
The `CDI` object is not namespaced and contains sensitive configuration data for the Containerized Data Importer.

## Rationale
Reduce at the minimum who can modify `CDI` resources.

## Impact
Workload owners don't normally need this feature.

## Audit Procedure
Check who can update the `cdi` resources:

```bash
$ oc adm policy who-can update cdi
```

## Remediation
Assign `update` access only to approved `cdi` objects in the cluster.

## Default Value
This permission is not granted by default.

## References
- CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0, Section 1.14

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4 Secure Configuration of Enterprise Assets and Software | N | N | N |
| v7 | 5.1 Establish Secure Configurations | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Persistence | T1098 Account Manipulation |
| Defense Evasion | T1562 Impair Defenses |

## Profile
- Level 1 - OpenShift Virtualization
