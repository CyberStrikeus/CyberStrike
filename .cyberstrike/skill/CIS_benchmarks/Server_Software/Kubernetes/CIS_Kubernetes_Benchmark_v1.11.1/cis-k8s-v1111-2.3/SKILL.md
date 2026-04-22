---
name: cis-k8s-v1111-2.3
description: "Ensure that the --client-cert-auth argument is set to true (Automated)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, etcd, encryption, tls, certificates, peer-authentication]
cis_id: "2.3"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.3 Ensure that the --client-cert-auth argument is set to true (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

Enable client authentication on etcd service.

## Rationale

etcd is a highly-available key value store used by Kubernetes deployments for persistent storage of all of its REST API objects. These objects are sensitive in nature and should not be available to unauthenticated clients. You should enable the client authentication via valid certificates to secure the access to the etcd service.

## Impact

All clients attempting to access the etcd server will require a valid client certificate.

## Audit

Run the following command on the etcd server node:

```bash
ps -ef | grep etcd
```

Verify that the `--client-cert-auth` argument is set to `true`.

## Remediation

Edit the etcd pod specification file `/etc/kubernetes/manifests/etcd.yaml` on the master node and set the below parameter.

```
--client-cert-auth="true"
```

## Default Value

By default, the etcd service can be queried by unauthenticated clients.

## References

1. https://coreos.com/etcd/docs/latest/op-guide/security.html
2. https://kubernetes.io/docs/admin/etcd/
3. https://coreos.com/etcd/docs/latest/op-guide/configuration.html#client-cert-auth

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | x | x |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | x |
