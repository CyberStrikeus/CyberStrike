---
name: cis-k8s-v200-1.3.1
description: "Ensure that the --terminated-pod-gc-threshold argument is set as appropriate (Manual)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, controller-manager]
cis_id: "1.3.1"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Kubernetes Benchmark v2.0.0 - Control 1.3.1

## Profile Applicability

- **Level:** 1 - Master Node

## Description

Activate garbage collector on pod termination, as appropriate.

## Rationale

Garbage collection is important to ensure sufficient resource availability and avoiding degraded performance and availability. In the worst case, the system might crash or just be unusable for a long period of time. The current setting for garbage collection is 12,500 terminated pods which might be too high for your system to sustain. Based on your system resources and tests, choose an appropriate threshold value to activate garbage collection.

## Impact

None

## Audit Procedure

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-controller-manager
```

Verify that the `--terminated-pod-gc-threshold` argument is set as appropriate.

## Remediation

Edit the Controller Manager pod specification file `/etc/kubernetes/manifests/kube-controller-manager.yaml` on the Control Plane node and set the `--terminated-pod-gc-threshold` to an appropriate threshold, for example:

```
--terminated-pod-gc-threshold=10
```

## Default Value

By default, `--terminated-pod-gc-threshold` is set to `12500`.

## References

1. https://kubernetes.io/docs/admin/kube-controller-manager/
2. https://github.com/kubernetes/kubernetes/issues/28484

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 10.5 Enable Anti-Exploitation Features<br/>Enable anti-exploitation features on enterprise assets and software, where possible, such as Microsoft Data Execution Prevention (DEP), Windows Defender Exploit Guard (WDEG), or Apple System Integrity Protection (SIP) and Gatekeeper. |      | ●    | ●    |
| v7               | 5.1 Establish Secure Configurations<br/>Maintain documented, standard security configuration standards for all authorized operating systems and software.                                                                                                                            | ●    | ●    | ●    |

## Profile

**Level 1 - Master Node** (Manual)
