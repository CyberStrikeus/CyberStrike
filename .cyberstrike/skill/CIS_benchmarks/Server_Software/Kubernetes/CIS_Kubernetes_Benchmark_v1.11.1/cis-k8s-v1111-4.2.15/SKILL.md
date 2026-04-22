---
name: cis-k8s-v1111-4.2.15
description: "Ensure that the --IPAddressDeny is set to any (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags:
  [
    cis,
    kubernetes,
    worker-nodes,
    kubelet,
    authentication,
    authorization,
    tls,
    streaming,
    iptables,
    hostname-override,
    event-capture,
    certificate-rotation,
    seccomp,
    strong-ciphers,
  ]
cis_id: "4.2.15"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.15 Ensure that the --IPAddressDeny is set to any (Manual)

## Profile Applicability

- Level 2 - Worker Node

## Description

Ensuring that `--IPAddressDeny` is set to "Any" will facilitate allowlisting of only IP addresses that are explicitly set with the `--IPAddressAllow` parameter which will block unspecified IP addresses from communicating with the **kubelet** component.

## Rationale

By default, Kubernetes allows any IP address to communicate with the **kubelet** component IP restrictions and IP whitelisting are security best practices and reduce the attack surface of the **kubelet**.

## Impact

Configuring the setting `IPAddressDeny=any` will deny service to any IP address not specified in the complimentary setting `IPAddressDeny=any` configuration parameter. Applying `IPAddressDeny=any` alone will completely disable communication with the component.

## Audit

Review the Kubelet's start-up parameters for the value of `--IPAddressDeny`, and check the Kubelet configuration file for `IPAddressDeny=any`.
If this entry is present it should be accompanied by `IPAddressAllow={{ kubelet_secure_addresses }}` to allow the control plane to communicate with the component.

## Remediation

```
IPAddressDeny=any
IPAddressAllow={{ kubelet_secure_addresses }}
```

\*Note
kubelet_secure_addresses: "localhost link-local {{ kube_pods_subnets | regex_replace(',', ' ') }} {{ kube_node_addresses }} {{ loadbalancer_apiserver.address | default("") }}"

## Default Value

By default IPAddressDeny is not enabled.

## References

1. [https://github.com/kubernetes-sigs/kubespray/pull/9194/files](https://github.com/kubernetes-sigs/kubespray/pull/9194/files)
2. [https://kubernetes.io/docs/concepts/services-networking/network-policies/](https://kubernetes.io/docs/concepts/services-networking/network-policies/)

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 2.5 Allowlist Authorized Software                 |      | x    | x    |
| v8               | 2.7 Allowlist Authorized Scripts                  |      |      | x    |
| v7               | 2.7 Utilize Application Whitelisting              |      |      | x    |
| v7               | 2.9 Implement Application Whitelisting of Scripts |      |      | x    |
