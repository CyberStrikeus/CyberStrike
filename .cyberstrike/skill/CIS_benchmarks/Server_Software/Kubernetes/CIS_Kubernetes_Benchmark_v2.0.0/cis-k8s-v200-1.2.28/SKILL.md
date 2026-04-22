---
name: cis-k8s-v200-1.2.28
description: "Ensure that encryption providers are appropriately configured (Manual)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, api-server, encryption, etcd, secrets, aescbc, kms, secretbox]
cis_id: "1.2.28"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.28 Ensure that encryption providers are appropriately configured (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Where `etcd` encryption is used, appropriate providers should be configured.

## Rationale

Where `etcd` encryption is used, it is important to ensure that the appropriate set of encryption providers is used. Currently, the `aescbc`, `kms`, and `secretbox` are likely to be appropriate options.

## Impact

None

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-apiserver
```

Get the `EncryptionConfig` file set for `--encryption-provider-config` argument. Verify that `aescbc`, `kms`, or `secretbox` is set as the encryption provider for all the desired `resources`.

## Remediation

Follow the Kubernetes documentation and configure a `EncryptionConfig` file. In this file, choose `aescbc`, `kms`, or `secretbox` as the encryption provider.

## Default Value

By default, no encryption provider is set.

## References

1. https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/
2. https://acotten.com/post/kube17-security
3. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
4. https://github.com/kubernetes/enhancements/issues/92
5. https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/#providers

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest        |      | \*   | \*   |
| v7               | 14.8 Encrypt Sensitive Information at Rest |      |      | \*   |
