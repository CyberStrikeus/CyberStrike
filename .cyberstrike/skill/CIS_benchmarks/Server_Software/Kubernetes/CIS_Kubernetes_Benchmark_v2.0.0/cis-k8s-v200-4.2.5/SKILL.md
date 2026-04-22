---
name: cis-k8s-v200-4.2.5
description: "Ensure that the --streaming-connection-idle-timeout argument is not set to 0 (Manual)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, worker-node, kubelet, streaming-timeout, connection]
cis_id: "4.2.5"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
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

```bash
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

1. https://kubernetes.io/docs/admin/kubelet/
2. https://github.com/kubernetes/kubernetes/pull/18552

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 10.5 Enable Anti-Exploitation Features - Enable anti-exploitation features on enterprise assets and software, where possible, such as Microsoft Data Execution Prevention (DEP), Windows Defender Exploit Guard (WDEG), or Apple System Integrity Protection (SIP) and Gatekeeper. | | * | * |
| v7 | 8.3 Enable Operating System Anti-Exploitation Features/Deploy Anti-Exploit Technologies - Enable anti-exploitation features such as Data Execution Prevention (DEP) or Address Space Layout Randomization (ASLR) that are available in an operating system or deploy appropriate toolkits that can be configured to apply protection to a broader set of applications and executables. | | * | * |
