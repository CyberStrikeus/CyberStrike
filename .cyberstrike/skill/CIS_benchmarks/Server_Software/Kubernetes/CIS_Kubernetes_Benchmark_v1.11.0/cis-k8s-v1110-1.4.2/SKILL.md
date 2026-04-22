---
name: cis-k8s-v1110-1.4.2
description: "Ensure that the --bind-address argument is set to 127.0.0.1 (Automated)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, scheduler, bind-address, network]
cis_id: "1.4.2"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.4.2 Ensure that the --bind-address argument is set to 127.0.0.1 (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

Do not bind the scheduler service to non-loopback insecure addresses.

## Rationale

The Scheduler API service which runs on port 10251/TCP by default is used for health and metrics information and is available without authentication or encryption. As such it should only be bound to a localhost interface, to minimize the cluster's attack surface

## Impact

None

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-scheduler
```

Verify that the `--bind-address` argument is set to 127.0.0.1

## Remediation

Edit the Scheduler pod specification file `/etc/kubernetes/manifests/kube-scheduler.yaml` on the Control Plane node and ensure the correct value for the `--bind-address` parameter

## Default Value

By default, the `--bind-address` parameter is set to 0.0.0.0

## References

1. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-scheduler/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 12.6 Use of Secure Network Management and Communication Protocols | | X | X |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | X | X |
