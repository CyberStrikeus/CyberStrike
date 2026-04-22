---
name: cis-ocp-vm-v100-2-2
description: "Disable overcommitting guest memory (Manual)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, openshift-virtualization, kubevirt, vm, virtual-machine-configuration]
cis_id: "2.2"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.2 — Disable overcommitting guest memory

## Profile Applicability
- Level 1

## Description
The `overcommitGuestOverhead` configuration option enables the request for additional virtual machine management memory inside the `virt-launcher` pod. The overcommit feature is used to increase virtual machine density on the node, as long as the virtual machine doesn't request all the memory that it would need if fully loaded. However, if the VM were to use all of the memory it could, this would lead to the OpenShift Scheduler killing the workload.

## Rationale
This is a hypervisor-level feature that allows nodes to host more virtual machines than would normally be allowed by KubeVirt's scheduling algorithms. If the VM consumes the entire memory might cause the guest to crash with workload interruptions and guest malfunctioning.

## Impact
`overCommitGuestOverhead` is used to (unsafely)increase workload density, meaning more virtual machines might be able to run on a node than otherwise.

## Audit Procedure
Verify that no virtual machines are using the `overcommitGuestOverhead` setting:

```
$ oc get vm -ojson -A |jq '.items[] | select(.spec.template.spec.domain.resources.overcommitGuestOverhead == true)| .metadata.namespace + "/" + .metadata.name'
```

## Remediation
Stop any guest with this flag enabled and remove the flag before restarting. This flag can be removed on a given VM with the following command:

```
$ oc patch vm <vm-name> --type='json' -p='[
    {"op": "remove", "path": "/spec/template/spec/domain/resources/overcommitGuestOverhead"},
]'
```

## Default Value
OpenShift Virtualization disables `overcommitGuestOverhead` by default and the list of virtual machines returned by the command should be `empty`.

## References
None listed in the PDF.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | N | Y | Y |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Impact | T1499 - Endpoint Denial of Service |
| Impact | T1498 - Network Denial of Service |

## Profile
- Level 1 - OpenShift Virtualization
