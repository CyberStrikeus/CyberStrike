---
name: cis-k8s-v1111-1.3.7
description: "Ensure that the --bind-address argument is set to 127.0.0.1 (Automated)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, controller-manager, service-account, profiling, credentials, tls]
cis_id: "1.3.7"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.3.7 Ensure that the --bind-address argument is set to 127.0.0.1 (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

Do not bind the Controller Manager service to non-loopback insecure addresses.

## Rationale

The Controller Manager API service which runs on port 10252/TCP by default is used for health and metrics information and is available without authentication or encryption. As such it should only be bound to a localhost interface, to minimize the cluster's attack surface.

## Impact

None

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-controller-manager
```

Verify that the `--bind-address` argument is set to 127.0.0.1

## Remediation

Edit the Controller Manager pod specification file `/etc/kubernetes/manifests/kube-controller-manager.yaml` on the Control Plane node and ensure the correct value for the `--bind-address` parameter.

## Default Value

By default, the `--bind-address` parameter is set to 0.0.0.0

## References

1. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/

## Additional Information

Although the current Kubernetes documentation site says that `--address` is deprecated in favour of `--bind-address` Kubeadm 1.11 still makes use of `--address`

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 12.6 Use of Secure Network Management and Communication Protocols | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |
