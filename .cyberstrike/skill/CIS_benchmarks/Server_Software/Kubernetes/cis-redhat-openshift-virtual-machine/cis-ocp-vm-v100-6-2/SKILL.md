---
name: cis-ocp-vm-v100-6-2
description: "Enable vCPU metrics (Manual)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, openshift-virtualization, kubevirt, vm, host-kernel]
cis_id: "6.2"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 6.2 — Enable vCPU metrics

## Profile Applicability

- Level 1

## Description

Openshift Virtualization provides metrics that you can use to monitor the consumption of cluster infrastructure resources, including vCPU. In order to use the vCPU metric, the `schedstats=enable` kernel argument must be applied.

## Rationale

Metrics are a fundamental mechanism for understanding if the guest is behaving in an anomolous suspicious manner.

## Impact

The kernel option is a prerequisite for using the prometheus metrics for the vCPU usage, without the metrics being reported.

## Audit Procedure

Verify if the option is enabled in the kernel command line:

```
$ cat /proc/cmdline | grep schedstats=enable
```

## Remediation

Enable the kernel option on all workernodes as documented in Chapter 1. Customizing nodes | Red Hat Product Documentation

## Default Value

OpenShift enables `schedstats` by default.The command should returns a string containing `schedstats=enable`.

## References

None listed in the PDF.

## CIS Controls

| Controls Version | Control                     | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs      | Y    | Y    | Y    |
| v7               | 6.3 Enable Detailed Logging | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic          | Technique                                       |
| --------------- | ----------------------------------------------- |
| Discovery       | T1082 - System Information Discovery            |
| Defense Evasion | T1562.006 - Impair Defenses: Indicator Blocking |

## Profile

- Level 1 - OpenShift Virtualization
