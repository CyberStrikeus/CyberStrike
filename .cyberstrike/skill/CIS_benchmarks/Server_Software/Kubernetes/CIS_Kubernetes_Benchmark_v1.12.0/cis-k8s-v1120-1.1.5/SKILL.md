---
name: cis-k8s-v1120-1.1.5
description: "Ensure that the scheduler pod specification file permissions are set to 600 or more restrictive (Automated)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, config-files, scheduler, permissions, level1]
cis_id: "1.1.5"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1.5 Ensure that the scheduler pod specification file permissions are set to 600 or more restrictive (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

Ensure that the scheduler pod specification file has permissions of `600` or more restrictive.

## Rationale

The scheduler pod specification file controls various parameters that set the behavior of the Scheduler service in the master node. You should restrict its file permissions to maintain the integrity of the file. The file should be writable by only the administrators on the system.

## Impact

None

## Audit

Run the below command (based on the file location on your system) on the Control Plane node. For example,

```bash
stat -c %a /etc/kubernetes/manifests/kube-scheduler.yaml
```

Verify that the permissions are `600` or more restrictive.

## Remediation

Run the below command (based on the file location on your system) on the Control Plane node. For example,

```bash
chmod 600 /etc/kubernetes/manifests/kube-scheduler.yaml
```

## Default Value

By default, `kube-scheduler.yaml` file has permissions of `640`.

## References

1. [https://kubernetes.io/docs/admin/kube-scheduler/](https://kubernetes.io/docs/admin/kube-scheduler/)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | * | * | * |
| v7 | 14.6 Protect Information through Access Control Lists | * | * | * |
