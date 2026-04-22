---
name: cis-k8s-v1111-4.2.11
description: "Verify that the RotateKubeletServerCertificate argument is set to true (Manual)"
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
cis_id: "4.2.11"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.11 Verify that the RotateKubeletServerCertificate argument is set to true (Manual)

## Profile Applicability

- Level 1 - Worker Node

## Description

Enable kubelet server certificate rotation.

## Rationale

`RotateKubeletServerCertificate` causes the kubelet to both request a serving certificate after bootstrapping its client credentials and rotate the certificate as its existing credentials expire. This automated periodic rotation ensures that the there are no downtimes due to expired certificates and thus addressing availability in the CIA security triad.

Note: This recommendation only applies if you let kubelets get their certificates from the API server. In case your kubelet certificates come from an outside authority/tool (e.g. Vault) then you need to take care of rotation yourself.

## Impact

None

## Audit

Ignore this check if serverTLSBootstrap is true in the kubelet config file or if the --rotate-server-certificates parameter is set on kubelet
Run the following command on each node:

```bash
ps -ef | grep kubelet
```

Verify that `RotateKubeletServerCertificate` argument exists and is set to `true`.

## Remediation

Edit the kubelet service file `/etc/kubernetes/kubelet.conf` on each worker node and set the below parameter in `KUBELET_CERTIFICATE_ARGS` variable.

```
--feature-gates=RotateKubeletServerCertificate=true
```

Based on your system, restart the `kubelet` service. For example:

```bash
systemctl daemon-reload
systemctl restart kubelet.service
```

## Default Value

By default, kubelet server certificate rotation is enabled.

## References

1. [https://github.com/kubernetes/kubernetes/pull/45059](https://github.com/kubernetes/kubernetes/pull/45059)
2. [https://kubernetes.io/docs/admin/kubelet-tls-bootstrapping/#kubelet-configuration](https://kubernetes.io/docs/admin/kubelet-tls-bootstrapping/#kubelet-configuration)

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | x    | x    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | x    | x    |
