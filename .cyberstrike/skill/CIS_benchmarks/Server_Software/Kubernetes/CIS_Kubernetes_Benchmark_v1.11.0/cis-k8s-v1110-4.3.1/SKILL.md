---
name: cis-k8s-v1110-4.3.1
description: "Ensure that the kube-proxy metrics service is bound to localhost (Manual)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, worker-node, kube-proxy, metrics-bind-address, network-security]
cis_id: "4.3.1"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.3.1 Ensure that the kube-proxy metrics service is bound to localhost (Manual)

## Profile Applicability

- Level 1 - Worker Node

## Description

Do not bind the kube-proxy metrics port to non-loopback addresses.

## Rationale

kube-proxy has two APIs which provided access to information about the service and can be bound to network ports. The metrics API service includes endpoints (`/metrics` and `/configz`) which disclose information about the configuration and operation of kube-proxy. These endpoints should not be exposed to untrusted networks as they do not support encryption or authentication to restrict access to the data they provide.

## Impact

3rd party services which try to access metrics or configuration information related to kube-proxy will require access to the localhost interface of the node.

## Audit

review the start-up flags provided to kube proxy
Run the following command on each node:

```bash
ps -ef | grep -i kube-proxy
```

Ensure that the `--metrics-bind-address` parameter is not set to a value other than 127.0.0.1. From the output of this command gather the location specified in the `--config` parameter. Review any file stored at that location and ensure that it does not specify a value other than 127.0.0.1 for `metricsBindAddress`.

## Remediation

Modify or remove any values which bind the metrics service to a non-localhost address

## Default Value

The default value is `127.0.0.1:10249`

## References

1. [https://kubernetes.io/docs/reference/command-line-tools-reference/kube-proxy/](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-proxy/)

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 12.6 Use of Secure Network Management and Communication Protocols  |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running |      | x    | x    |
