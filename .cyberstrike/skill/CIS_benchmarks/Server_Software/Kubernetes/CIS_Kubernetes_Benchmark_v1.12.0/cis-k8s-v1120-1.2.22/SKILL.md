---
name: cis-k8s-v1120-1.2.22
description: "Ensure that the --service-account-key-file argument is set as appropriate (Automated)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, api-server, authentication, service-account, key-file]
cis_id: "1.2.22"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.22 Ensure that the --service-account-key-file argument is set as appropriate (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

Explicitly set a service account public key file for service accounts on the apiserver.

## Rationale

By default, if no `--service-account-key-file` is specified to the apiserver, it uses the private key from the TLS serving certificate to verify service account tokens. To ensure that the keys for service account tokens could be rotated as needed, a separate public/private key pair should be used for signing service account tokens. Hence, the public key should be specified to the apiserver with `--service-account-key-file`.

## Impact

The corresponding private key must be provided to the controller manager. You would need to securely maintain the key file and rotate the keys based on your organization's key rotation policy.

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-apiserver
```

Verify that the `--service-account-key-file` argument exists and is set as appropriate.

## Remediation

Edit the API server pod specification file `/etc/kubernetes/manifests/kube-apiserver.yaml` on the Control Plane node and set the `--service-account-key-file` parameter to the public key file for service accounts:

```
--service-account-key-file=<filename>
```

## Default Value

By default, `--service-account-key-file` argument is not set.

## References

1. [https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/)
2. [https://github.com/kubernetes/kubernetes/issues/24167](https://github.com/kubernetes/kubernetes/issues/24167)

## CIS Controls

| Controls Version | Control                  | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------ | ---- | ---- | ---- |
| v8               | 5.2 Use Unique Passwords | \*   | \*   | \*   |
| v7               | 4.4 Use Unique Passwords |      | \*   | \*   |
