---
name: cis-k8s-v1110-1.2.2
description: "Ensure that the --token-auth-file parameter is not set (Automated)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, api-server, token-auth, authentication, static-tokens]
cis_id: "1.2.2"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.2 Ensure that the --token-auth-file parameter is not set (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

Do not use token based authentication.

## Rationale

The token-based authentication utilizes static tokens to authenticate requests to the apiserver. The tokens are stored in clear-text in a file on the apiserver, and cannot be revoked or rotated without restarting the apiserver. Hence, do not use static token-based authentication.

## Impact

You will have to configure and use alternate authentication mechanisms such as certificates. Static token based authentication could not be used.

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-apiserver
```

Verify that the `--token-auth-file` argument does not exist.

Alternative Audit Method:

```bash
kubectl get pod -nkube-system -lcomponent=kube-apiserver -o=jsonpath='{range .items[*]}{.spec.containers[*].command} {"\n"}{end}' | grep '\--token-auth-file' | grep -i false
```

If the exit code is '1', then the control isn't present / failed.

## Remediation

Follow the documentation and configure alternate mechanisms for authentication. Then, edit the API server pod specification file `/etc/kubernetes/manifests/kube-apiserver.yaml` on the master node and remove the `--token-auth-file=<filename>` parameter.

## Default Value

By default, `--token-auth-file` argument is not set.

## References

1. https://kubernetes.io/docs/admin/authentication/#static-token-file
2. https://kubernetes.io/docs/admin/kube-apiserver/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4.6 Securely Manage Enterprise Assets and Software | * | * | * |
| v7 | 16.4 Encrypt or Hash all Authentication Credentials | | * | * |
