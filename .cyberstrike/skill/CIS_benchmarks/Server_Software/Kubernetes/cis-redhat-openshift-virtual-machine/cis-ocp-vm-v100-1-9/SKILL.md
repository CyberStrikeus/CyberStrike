---
name: cis-ocp-vm-v100-1-9
description: "Ensure kubevirt cache directory permission is set to 755 or more restrictive (Automated)"
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
    file-permissions,
    virt-handler,
    cache-directory,
  ]
cis_id: "1.9"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.9 — Ensure kubevirt cache directory permission is set to 755 or more restrictive

## Profile Applicability

- Level 1

## Description

Setting the `kubevirt` private directory to `755` or more restrictive limits access to security related administrative functionality to approved administrators.

## Rationale

This configuration ensures that the directory where virt-handler stores the virtual machine configuration for caching is restricted to administrators and Openshift Virtualization privileged node components.

## Impact

None.

## Audit Procedure

Directory permissions for the `virt-handler` pods, run the following command:

```bash
$ for pod in $(oc get po -n openshift-cnv -l kubevirt.io=virt-handler --no-headers -o custom-columns=":metadata.name"); do oc exec $pod -ti -n openshift-cnv -- stat -c %a /var/run/kubevirt-private ;done
```

Should return `755` or if the file doesn't exist then the corresponding feature gate is not enabled and this check can be safely ignored.

## Remediation

Update the permissions on each virt-handller using `chmod`:

```bash
$ oc exec <virt-handler-pod> -ti -n openshift-cnv -- chmod 755 /var/run/kubevirt-private
```

## Default Value

The default permissions of this directory are `755`.

## References

- CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0, Section 1.9

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | Y    | Y    | Y    |
| v7               | 14.6 Protect Information through Access Control Lists | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic               | Technique                                         |
| -------------------- | ------------------------------------------------- |
| Privilege Escalation | T1068 Exploitation for Privilege Escalation       |
| Defense Evasion      | T1222 File and Directory Permissions Modification |

## Profile

- Level 1 - OpenShift Virtualization
