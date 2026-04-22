---
name: cis-k8s-v1111-4.2.2
description: "Ensure that the --authorization-mode argument is not set to AlwaysAllow (Automated)"
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
cis_id: "4.2.2"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.2 Ensure that the --authorization-mode argument is not set to AlwaysAllow (Automated)

## Profile Applicability

- Level 1 - Worker Node

## Description

Do not allow all requests. Enable explicit authorization.

## Rationale

Kubelets, by default, allow all authenticated requests (even anonymous ones) without needing explicit authorization checks from the apiserver. You should restrict this behavior and only allow explicitly authorized requests.

## Impact

Unauthorized requests will be denied.

## Audit

Run the following command on each node:

```bash
ps -ef | grep kubelet
```

If the `--authorization-mode` argument is present check that it is not set to `AlwaysAllow`. If it is not present check that there is a Kubelet config file specified by `--config`, and that file sets `authorization: mode` to something other than `AlwaysAllow`.

It is also possible to review the running configuration of a Kubelet via the `/configz` endpoint on the Kubelet API port (typically `10250/TCP`). Accessing these with appropriate credentials will provide details of the Kubelet's configuration.

## Remediation

If using a Kubelet config file, edit the file to set `authorization: mode` to `Webhook`.
If using executable arguments, edit the kubelet service file `/etc/kubernetes/kubelet.conf` on each worker node and set the below parameter in `KUBELET_AUTHZ_ARGS` variable.

```
--authorization-mode=Webhook
```

Based on your system, restart the `kubelet` service. For example:

```bash
systemctl daemon-reload
systemctl restart kubelet.service
```

## Default Value

By default, `--authorization-mode` argument is set to `AlwaysAllow`.

## References

1. [https://kubernetes.io/docs/admin/kubelet/](https://kubernetes.io/docs/admin/kubelet/)
2. [https://kubernetes.io/docs/admin/kubelet-authentication-authorization/#kubelet-authentication](https://kubernetes.io/docs/admin/kubelet-authentication-authorization/#kubelet-authentication)

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists                            | x    | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running |      | x    | x    |
