---
name: cis-k8s-v200-1.4.2
description: "Ensure that the --bind-address argument is set to 127.0.0.1 (Automated)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, scheduler]
cis_id: "1.4.2"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Kubernetes Benchmark v2.0.0 - Control 1.4.2

## Profile Applicability

- **Level:** 1 - Master Node

## Description

Do not bind the scheduler service to non-loopback insecure addresses.

## Rationale

The Scheduler API service which runs on port 10251/TCP by default is used for health and metrics information and is available without authentication or encryption. As such it should only be bound to a localhost interface, to minimize the cluster's attack surface.

## Impact

None

## Audit Procedure

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-scheduler
```

Verify that the `--bind-address` argument is set to 127.0.0.1

## Remediation

Edit the Scheduler pod specification file `/etc/kubernetes/manifests/kube-scheduler.yaml` on the Control Plane node and ensure the correct value for the `--bind-address` parameter.

## Default Value

By default, the `--bind-address` parameter is set to 0.0.0.0

## References

1. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-scheduler/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 12.6 Use of Secure Network Management and Communication Protocols<br/>Use secure network management and communication protocols (e.g., 802.1X, Wi-Fi Protected Access 2 (WPA2) Enterprise or greater).          |      | ●    | ●    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running<br/>Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system. |      | ●    | ●    |

## Profile

**Level 1 - Master Node** (Automated)
