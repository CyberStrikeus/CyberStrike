---
name: cis-k8s-v1111-4.2.5
description: "Ensure that the --streaming-connection-idle-timeout argument is not set to 0 (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, worker-nodes, kubelet, authentication, authorization, tls, streaming, iptables, hostname-override, event-capture, certificate-rotation, seccomp, strong-ciphers]
cis_id: "4.2.5"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.5 Ensure that the --streaming-connection-idle-timeout argument is not set to 0 (Manual)

## Profile Applicability

- Level 1 - Worker Node

## Description

Do not disable timeouts on streaming connections.

## Rationale

Setting idle timeouts ensures that you are protected against Denial-of-Service attacks, inactive connections and running out of ephemeral ports.

**Note:** By default, `--streaming-connection-idle-timeout` is set to 4 hours which might be too high for your environment. Setting this as appropriate would additionally ensure that such streaming connections are timed out after serving legitimate use cases.

## Impact

Long-lived connections could be interrupted.

## Audit

Run the following command on each node:

```bash
ps -ef | grep kubelet
```

Verify that the `--streaming-connection-idle-timeout` argument is not set to `0`.
If the argument is not present, and there is a Kubelet config file specified by `--config`, check that it does not set `streamingConnectionIdleTimeout` to 0.

## Remediation

If using a Kubelet config file, edit the file to set `streamingConnectionIdleTimeout` to a value other than 0.
If using command line arguments, edit the kubelet service file `/etc/kubernetes/kubelet.conf` on each worker node and set the below parameter in `KUBELET_SYSTEM_PODS_ARGS` variable.

```
--streaming-connection-idle-timeout=5m
```

Based on your system, restart the `kubelet` service. For example:

```bash
systemctl daemon-reload
systemctl restart kubelet.service
```

## Default Value

By default, `--streaming-connection-idle-timeout` is set to 4 hours.

## References

1. [https://kubernetes.io/docs/admin/kubelet/](https://kubernetes.io/docs/admin/kubelet/)
2. [https://github.com/kubernetes/kubernetes/pull/18552](https://github.com/kubernetes/kubernetes/pull/18552)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 10.5 Enable Anti-Exploitation Features | | x | x |
| v7 | 8.3 Enable Operating System Anti-Exploitation Features/Deploy Anti-Exploit Technologies | | x | x |
