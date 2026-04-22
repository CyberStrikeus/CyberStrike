---
name: cis-ocp-vm-v100-5-1
description: "Disable Intel Trusted Execution Technology (TXT) (Manual)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, openshift-virtualization, kubevirt, vm, host-firmware]
cis_id: "5.1"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 5.1 — Disable Intel Trusted Execution Technology (TXT)

## Profile Applicability

- Level 1

## Description

Intel Trusted Execution Technology (TXT) is a security-related CPU feature that is not currently leveraged by OpenShift or Openshift virtualization.

## Rationale

Neither OCP nor Openshift Virtualization leverage Trusted Execution Technology, which can be safely disabled.

## Impact

None.

## Audit Procedure

Use the following command to return the BIOS settings for a physical host:

```
$ fwupdmgr get-bios-settings
```

Look for `TxT`, and ensure the `Current value` is `Disabled`

## Remediation

Disable TXT via the firmware settings of each worker node.

## Default Value

The default value is firmware-dependent.

## References

None listed in the PDF.

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | N    | Y    | Y    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic          | Technique                   |
| --------------- | --------------------------- |
| Persistence     | T1542 - Pre-OS Boot         |
| Defense Evasion | T1542.001 - System Firmware |

## Profile

- Level 1 - OpenShift Virtualization
