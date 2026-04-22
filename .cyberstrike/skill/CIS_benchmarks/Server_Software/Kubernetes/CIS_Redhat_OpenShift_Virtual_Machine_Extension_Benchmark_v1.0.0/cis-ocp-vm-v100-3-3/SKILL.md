---
name: cis-ocp-vm-v100-3-3
description: "Ensure errorPolicy is not set to ignore (Manual)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, openshift-virtualization, kubevirt, vm, storage-components]
cis_id: "3.3"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 3.3 — Ensure errorPolicy is not set to ignore

## Profile Applicability
- Level 1

## Description
Error policies for disks control how Input/Output (IO) errors are handled. If a read or write operation fails on the storage, an IO error occurs. Setting the error policy to `ignore` is not recommended because it makes it difficult to determine the root cause of any IO issues, which can lead to data loss if the data is not correctly written to the disk.

## Rationale
Certain applications, such as Windows Shared Cluster Filesystem, require a different behavior than the default error policy setting. IO errors need to be reported to the guest Operating System by setting the `errorPolicy` to `report`.

## Impact
Emergency or maintenance activities may require reducing log generation by temporarily ignoring the IO errors. This may be accomplished by setting the `errorPolicy` to `ignore`.

## Audit Procedure
Verify that no virtual machines are using the `errorPolicy` set to `ignore`:

```
$ oc get vm -ojson -A | jq '.items[] | select(.spec.template.spec.domain.devices.disks[].errorPolicy == "ignore")| .metadata.namespace + "/" + .metadata.name'
```

## Remediation
Remove the `errorPolicy` or set it to `stop`(default value) or `report` (suggested option for Windows Shared Cluster Filesystem). For example, to remove the `errorPolicy` flag on the first disk (index 0) of a given VM, this command can be used:

```
$ oc patch vm <vm-name> --type='json' -p='[
    {"op": "remove", "path": "/spec/template/spec/domain/devices/disks/0/errorPolicy"},
]'
```

To set an `errorPolicy` flag to stop on every disk, this (experimental) command can be used:

```
$ oc get vm <vm-name> -o json | jq '.spec.template.spec.domain.devices.disks[] += {"errorPolicy":"stop"}' | oc apply -f -
```

## Default Value
By default the `errorPolicy` is not set on any disk and the default value is `stop`. The audit procedure should return an `empty` list.

## References
None listed in the PDF.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs | Y | Y | Y |
| v7 | 6.3 Enable Detailed Logging | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Defense Evasion | T1562.006 - Impair Defenses: Indicator Blocking |
| Impact | T1485 - Data Destruction |

## Profile
- Level 1 - OpenShift Virtualization
