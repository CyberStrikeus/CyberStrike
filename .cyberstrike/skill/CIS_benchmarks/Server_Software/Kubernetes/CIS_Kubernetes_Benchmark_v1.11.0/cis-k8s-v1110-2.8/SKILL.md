---
name: cis-k8s-v1110-2.8
description: "Ensure that a unique Certificate Authority is used for etcd (Manual)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, etcd, certificate-authority, tls]
cis_id: "2.8"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.8 Ensure that a unique Certificate Authority is used for etcd (Manual)

## Profile Applicability

- Level 2 - Master Node

## Description

Use a different certificate authority for etcd from the one used for Kubernetes.

## Rationale

etcd is a highly available key-value store used by Kubernetes deployments for persistent storage of all of its REST API objects. Its access should be restricted to specifically designated clients and peers only.

Authentication to etcd is based on whether the certificate presented was issued by a trusted certificate authority. There is no checking of certificate attributes such as common name or subject alternative name. As such, if any attackers were able to gain access to any certificate issued by the trusted certificate authority, they would be able to gain full access to the etcd database.

## Impact

Additional management of the certificates and keys for the dedicated certificate authority will be required.

## Audit

Review the CA used by the etcd environment and ensure that it does not match the CA certificate file used for the management of the overall Kubernetes cluster.
Run the following command on the master node:

```bash
ps -ef | grep etcd
```

Note the file referenced by the `--trusted-ca-file` argument.
Run the following command on the master node:

```bash
ps -ef | grep apiserver
```

Verify that the file referenced by the `--client-ca-file` for apiserver is different from the `--trusted-ca-file` used by etcd.

## Remediation

Follow the etcd documentation and create a dedicated certificate authority setup for the etcd service.
Then, edit the etcd pod specification file `/etc/kubernetes/manifests/etcd.yaml` on the master node and set the below parameter.

```
--trusted-ca-file=</path/to/ca-file>
```

## Default Value

By default, no etcd certificate is created and used.

## References

1. https://coreos.com/etcd/docs/latest/op-guide/security.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.1 Establish an Access Granting Process | X | X | X |
| v8 | 6.2 Establish an Access Revoking Process | X | X | X |
