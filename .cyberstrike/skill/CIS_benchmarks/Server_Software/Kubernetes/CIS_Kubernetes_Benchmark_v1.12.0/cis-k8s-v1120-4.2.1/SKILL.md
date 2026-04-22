---
name: cis-k8s-v1120-4.2.1
description: "Ensure that the --anonymous-auth argument is set to false (Automated)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, worker-nodes, kubelet]
cis_id: "4.2.1"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Kubernetes Benchmark v1.12.0 - Control 4.2.1

## Description

Disable anonymous requests to the Kubelet server.

## Rationale

When enabled, requests that are not rejected by other configured authentication methods are treated as anonymous requests. These requests are then served by the Kubelet server. You should rely on authentication to authorize access and disallow anonymous requests.

## Impact

Anonymous requests will be rejected.

## Audit Procedure

### Step 1: Check kubelet configuration file

If using a Kubelet configuration file, check that there is an entry for `authentication: anonymous: enabled` set to `false`.

### Step 2: Verify via process arguments

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

1. https://kubernetes.io/docs/admin/kubelet/
2. https://kubernetes.io/docs/admin/kubelet-authentication-authorization/#kubelet-authentication

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ● | ● | ● |
| v7 | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. | ● | ● | ● |

## Profile Applicability

- Level 1 - Worker Node

## Assessment Status

Automated
