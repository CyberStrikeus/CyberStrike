---
name: cis-k8s-v1120-1.2.27
description: "Ensure that the --encryption-provider-config argument is set as appropriate (Manual)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, api-server, encryption, etcd, secrets]
cis_id: "1.2.27"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.27 Ensure that the --encryption-provider-config argument is set as appropriate (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Encrypt etcd key-value store.

## Rationale

etcd is a highly available key-value store used by Kubernetes deployments for persistent storage of all of its REST API objects. These objects are sensitive in nature and should be encrypted at rest to avoid any disclosures.

## Impact

None

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-apiserver
```

Verify that the `--encryption-provider-config` argument is set to a `EncryptionConfig` file. Additionally, ensure that the `EncryptionConfig` file has all the desired `resources` covered especially any secrets.

## Remediation

Follow the Kubernetes documentation and configure a `EncryptionConfig` file. Then, edit the API server pod specification file `/etc/kubernetes/manifests/kube-apiserver.yaml` on the master node and set the `--encryption-provider-config` parameter to the path of that file:

```
--encryption-provider-config=</path/to/EncryptionConfig/File>
```

## Default Value

By default, `--encryption-provider-config` is not set.

## References

1. [https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/)
2. [https://acotten.com/post/kube17-security](https://acotten.com/post/kube17-security)
3. [https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/)
4. [https://github.com/kubernetes/enhancements/issues/92](https://github.com/kubernetes/enhancements/issues/92)

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest        |      | \*   | \*   |
| v7               | 14.8 Encrypt Sensitive Information at Rest |      |      | \*   |
