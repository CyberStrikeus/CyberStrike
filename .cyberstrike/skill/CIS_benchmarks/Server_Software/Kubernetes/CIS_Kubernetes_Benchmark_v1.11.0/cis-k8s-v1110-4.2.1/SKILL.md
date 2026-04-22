---
name: cis-k8s-v1110-4.2.1
description: "Ensure that the --anonymous-auth argument is set to false (Automated)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, worker-node, kubelet, anonymous-auth, authentication]
cis_id: "4.2.1"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.1 Ensure that the --anonymous-auth argument is set to false (Automated)

## Profile Applicability

- Level 1 - Worker Node

## Description

Disable anonymous requests to the Kubelet server.

## Rationale

When enabled, requests that are not rejected by other configured authentication methods are treated as anonymous requests. These requests are then served by the Kubelet server. You should rely on authentication to authorize access and disallow anonymous requests.

## Impact

Anonymous requests will be rejected.

## Audit

If using a Kubelet configuration file, check that there is an entry for `authentication: anonymous: enabled` set to `false`.
Run the following command on each node:

```bash
ps -ef | grep kubelet
```

Verify that the `--anonymous-auth` argument is set to `false`.
This executable argument may be omitted, provided there is a corresponding entry set to `false` in the Kubelet config file.

## Remediation

If using a Kubelet config file, edit the file to set `authentication: anonymous: enabled` to `false`.
If using executable arguments, edit the kubelet service file `/etc/kubernetes/kubelet.conf` on each worker node and set the below parameter in `KUBELET_SYSTEM_PODS_ARGS` variable.

```
--anonymous-auth=false
```

Based on your system, restart the `kubelet` service. For example:

```bash
systemctl daemon-reload
systemctl restart kubelet.service
```

## Default Value

By default, anonymous access is enabled.

## References

1. [https://kubernetes.io/docs/admin/kubelet/](https://kubernetes.io/docs/admin/kubelet/)
2. [https://kubernetes.io/docs/admin/kubelet-authentication-authorization/#kubelet-authentication](https://kubernetes.io/docs/admin/kubelet-authentication-authorization/#kubelet-authentication)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |
