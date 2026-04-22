---
name: cis-k8s-v1110-1.3.4
description: "Ensure that the --service-account-private-key-file argument is set as appropriate (Automated)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, controller-manager, service-account, private-key]
cis_id: "1.3.4"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.3.4 Ensure that the --service-account-private-key-file argument is set as appropriate (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

Explicitly set a service account private key file for service accounts on the controller manager.

## Rationale

To ensure that keys for service account tokens can be rotated as needed, a separate public/private key pair should be used for signing service account tokens. The private key should be specified to the controller manager with `--service-account-private-key-file` as appropriate.

## Impact

You would need to securely maintain the key file and rotate the keys based on your organization's key rotation policy.

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-controller-manager
```

Verify that the `--service-account-private-key-file` argument is set as appropriate.

## Remediation

Edit the Controller Manager pod specification file `/etc/kubernetes/manifests/kube-controller-manager.yaml` on the Control Plane node and set the `--service-account-private-key-file` parameter to the private key file for service accounts.

```
--service-account-private-key-file=<filename>
```

## Default Value

By default, `--service-account-private-key-file` it not set.

## References

1. https://kubernetes.io/docs/admin/kube-controller-manager/

## CIS Controls

| Controls Version | Control                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.2 Use Unique Passwords                       | X    | X    | X    |
| v7               | 4.4 Use Unique Passwords                       |      | X    | X    |
| v6               | 14 Controlled Access Based on the Need to Know |      |      |      |
