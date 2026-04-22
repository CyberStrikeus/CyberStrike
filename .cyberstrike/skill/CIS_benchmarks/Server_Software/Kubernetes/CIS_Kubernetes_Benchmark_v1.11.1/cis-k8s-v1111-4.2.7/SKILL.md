---
name: cis-k8s-v1111-4.2.7
description: "Ensure that the --hostname-override argument is not set (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, worker-nodes, kubelet, authentication, authorization, tls, streaming, iptables, hostname-override, event-capture, certificate-rotation, seccomp, strong-ciphers]
cis_id: "4.2.7"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.7 Ensure that the --hostname-override argument is not set (Manual)

## Profile Applicability

- Level 1 - Worker Node

## Description

Do not override node hostnames.

## Rationale

Overriding hostnames could potentially break TLS setup between the kubelet and the apiserver. Additionally, with overridden hostnames, it becomes increasingly difficult to associate logs with a particular node and process them for security analytics. Hence, you should setup your kubelet nodes with resolvable FQDNs and avoid overriding the hostnames with IPs.

## Impact

Some cloud providers may require this flag to ensure that hostname matches names issued by the cloud provider. In these environments, this recommendation should not apply.

## Audit

Run the following command on each node:

```bash
ps -ef | grep kubelet
```

Verify that `--hostname-override` argument does not exist.
**Note** This setting is not configurable via the Kubelet config file.

## Remediation

Edit the kubelet service file `/etc/systemd/system/kubelet.service.d/10-kubeadm.conf` on each worker node and remove the `--hostname-override` argument from the `KUBELET_SYSTEM_PODS_ARGS` variable.
Based on your system, restart the `kubelet` service. For example:

```bash
systemctl daemon-reload
systemctl restart kubelet.service
```

## Default Value

By default, `--hostname-override` argument is not set.

## References

1. [https://kubernetes.io/docs/admin/kubelet/](https://kubernetes.io/docs/admin/kubelet/)
2. [https://github.com/kubernetes/kubernetes/issues/22063](https://github.com/kubernetes/kubernetes/issues/22063)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4 Secure Configuration of Enterprise Assets and Software | | | |
| v7 | 5 Secure Configuration for Hardware and Software on Mobile Devices, Laptops, Workstations and Servers | | | |
