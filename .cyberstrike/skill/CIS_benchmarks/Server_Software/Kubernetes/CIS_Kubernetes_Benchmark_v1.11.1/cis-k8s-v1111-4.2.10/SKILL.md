---
name: cis-k8s-v1111-4.2.10
description: "Ensure that the --rotate-certificates argument is not set to false (Automated)"
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
cis_id: "4.2.10"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.10 Ensure that the --rotate-certificates argument is not set to false (Automated)

## Profile Applicability

- Level 1 - Worker Node

## Description

Enable kubelet client certificate rotation.

## Rationale

The `--rotate-certificates` setting causes the kubelet to rotate its client certificates by creating new CSRs as its existing credentials expire. This automated periodic rotation ensures that the there is no downtime due to expired certificates and thus addressing availability in the CIA security triad.

**Note:** This recommendation only applies if you let kubelets get their certificates from the API server. In case your kubelet certificates come from an outside authority/tool (e.g. Vault) then you need to take care of rotation yourself.

**Note:** This feature also require the `RotateKubeletClientCertificate` feature gate to be enabled (which is the default since Kubernetes v1.7)

## Impact

None

## Audit

Run the following command on each node:

```bash
ps -ef | grep kubelet
```

Verify that the `RotateKubeletServerCertificate` argument is not present, or is set to `true`.
If the RotateKubeletServerCertificate argument is not present, verify that if there is a Kubelet config file specified by `--config`, that file does not contain `RotateKubeletServerCertificate: false`.

## Remediation

If using a Kubelet config file, edit the file to add the line `rotateCertificates: true` or remove it altogether to use the default value.
If using command line arguments, edit the kubelet service file `/etc/kubernetes/kubelet.conf` on each worker node and remove `--rotate-certificates=false` argument from the `KUBELET_CERTIFICATE_ARGS` variable or set --rotate-certificates=true .
Based on your system, restart the `kubelet` service. For example:

```bash
systemctl daemon-reload
systemctl restart kubelet.service
```

## Default Value

By default, kubelet client certificate rotation is enabled.

## References

1. [https://github.com/kubernetes/kubernetes/pull/41912](https://github.com/kubernetes/kubernetes/pull/41912)
2. [https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet-tls-bootstrapping/#kubelet-configuration](https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet-tls-bootstrapping/#kubelet-configuration)
3. [https://kubernetes.io/docs/imported/release/notes/](https://kubernetes.io/docs/imported/release/notes/)
4. [https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/](https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/)

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | x    | x    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | x    | x    |
