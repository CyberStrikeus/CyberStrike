---
name: cis-ocp-vm-v100-6-1
description: "Disable nested virtualization (Manual)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, openshift-virtualization, kubevirt, vm, host-kernel]
cis_id: "6.1"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 6.1 — Disable nested virtualization

## Profile Applicability

- Level 1

## Description

Enabling nested virtualization in OpenShift Virtualization allows virtual machines to run within a hypervisor that is itself running on top of an existing operating system. This setup, known as nested virtualization, enables the VMs to access the full range of virtualization features provided by the underlying host, including access to the virtualization stack. In this case, Openshift Virtualization uses nested virtualization to provide its VMs with access to the entire virtualization stack, allowing them to take advantage of advanced virtualization capabilities such as live migration, resource pooling, and cloning. Nest virtualization is required if the cluster admin expects users to run Windows guest and Windows Subsystem for Linux (WSL) 2.

## Rationale

While nested virtualization has safeguards in place to prevent malicious activity, disabling it undeniably reduces the attack surface.

## Impact

Nested virtualization is required for special use-cases when cluster-admins expect to use virtualization inside the guests i.e. if the VMs in the cluster may need virtualization, for WSL2 or other purposes.

Note:If nested virtualization is disabled, Openshift Virtualization VMs will not be able to use hardware virtualization to start their own VMs. Windows guests will also be unable to use WSL2.

## Audit Procedure

To check the state of nested virtualization on nodes running on Intel CPUs:

```
$ cat /sys/module/kvm_intel/parameters/nested
```

Disabled is denoted by `0`, and enable is denoted with `1`. If you're using AMD CPUs, replace `kvm_intel` with `kvm_amd`.

## Remediation

Add the appropriate kernel arguments to the MachineConfigPools of the workers nodes and reboot them. See https://docs.redhat.com/en/documentation/openshift_container_platform/4.18/html/installation \_configuration/installing-customizing#installation-special-config-kargs_installing-customizing

## Default Value

OpenShift does not enable nested virtualization by default.

## References

None listed in the PDF.

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | N    | Y    | Y    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic               | Technique                              |
| -------------------- | -------------------------------------- |
| Privilege Escalation | T1611 - Escape to Host                 |
| Defense Evasion      | T1497 - Virtualization/Sandbox Evasion |

## Profile

- Level 1 - OpenShift Virtualization
