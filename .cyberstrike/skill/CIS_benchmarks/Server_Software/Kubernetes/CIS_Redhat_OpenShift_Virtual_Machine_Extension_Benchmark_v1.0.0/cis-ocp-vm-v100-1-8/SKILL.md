---
name: cis-ocp-vm-v100-1-8
description: "Ensure kubevirt seccomp profile file permission is set to 700 or more restrictive (Automated)"
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
    seccomp,
    file-permissions,
    virt-launcher,
  ]
cis_id: "1.8"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.8 — Ensure kubevirt seccomp profile file permission is set to 700 or more restrictive

## Profile Applicability

- Level 1

## Description

Setting the `kubevirt` Secure Computing Mode (seccomp) file permissions to `700` or more restrictive limits access to security related administrative functionality to approved administrators.

## Rationale

This configuration ensures that only authorized users have access to modify the seccomp profile, thereby preventing unauthorized alterations to the allowed system calls for virt-launcher pods. By enforcing stringent permission controls, potential security risks associated with unrestricted access to sensitive system calls can be mitigated.

## Impact

None.

## Audit Procedure

Verify seccomp file permissions for the `virt-launcher` pod, run the following command:

```bash
$ for pod in $(oc get pod -n openshift-cnv -l kubevirt.io=virt-handler --no-headers -o custom-columns=":metadata.name");do
  oc exec -ti -n openshift-cnv $pod -c virt-handler -- stat -c %a /proc/1/root/var/lib/kubelet/seccomp/kubevirt/kubevirt.json
done
```

Should return `700` or if the file doesn't exist then the corresponding feature gate is not enabled and this check can be safely ignored.

## Remediation

Update the permissions on each node using `chmod`:

```bash
$ oc exec <virt-handler-pod> -ti -n openshift-cnv -- chmod 700 /proc/1/root/var/lib/kubelet/seccomp/kubevirt/kubevirt.json
```

## Default Value

If the Secure Computing Mode feature is enabled, the permissions of this file are `700` by default.

## References

- CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0, Section 1.8

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
