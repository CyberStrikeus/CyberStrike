---
name: cis-k8s-v200-4.2.1
description: "Ensure that the --anonymous-auth argument is set to false (Automated)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, worker-node, kubelet, authentication, anonymous-auth]
cis_id: "4.2.1"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
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

```bash
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

1. https://kubernetes.io/docs/admin/kubelet/
2. https://kubernetes.io/docs/admin/kubelet-authentication-authorization/#kubelet-authentication

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | * | * | * |
| v7 | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | * | * | * |
