---
name: cis-ocp-vm-v100-1-4
description: "Disable downwardMetrics feature gate (Automated)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, openshift-virtualization, kubevirt, vm, platform-configuration, feature-gate, downward-metrics, information-disclosure]
cis_id: "1.4"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.4 — Disable downwardMetrics feature gate

## Profile Applicability
- Level 1

## Description
The `downwardMetrics` feature allows users to collect and monitor additional metrics related to host and virtual machine performance.

## Rationale
Enabling the `downwardMetrics` feature introduces the risk of unauthorized or unintended sharing of information, as well as manipulation of information flow restrictions. The additional metrics include sensitive performance data, which could aid in the reconnaissance activities of a malicious actor.

## Impact
Guests are not able to use the host metrics.

## Audit Procedure
Check the `downwardMetrics` feature gate is disabled:

```bash
$ oc get hyperconverged kubevirt-hyperconverged -n openshift-cnv -ojsonpath='{.spec.featureGates.downwardMetrics}'
```

Verify the output is `false`.

## Remediation
Set `downwardMetrics` to `False`:

```bash
$ oc patch hyperconverged kubevirt-hyperconverged -n openshift-cnv --type='json' -p='[
  {"op": "replace", "path": "/spec/featureGates/downwardMetrics", "value": false },
]'
```

## Default Value
By default, the `downwardMetrics` is set to `false`.

## References
- CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0, Section 1.4

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs | Y | Y | Y |
| v8 | 8.3 Ensure Adequate Audit Log Storage | Y | Y | Y |
| v7 | 6.3 Enable Detailed Logging | N | Y | Y |
| v7 | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data | N | N | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Discovery | T1082 System Information Discovery |
| Reconnaissance | T1592 Gather Victim Host Information |

## Profile
- Level 1 - OpenShift Virtualization
