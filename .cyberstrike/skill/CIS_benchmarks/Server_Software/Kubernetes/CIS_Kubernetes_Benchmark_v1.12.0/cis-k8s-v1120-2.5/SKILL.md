---
name: cis-k8s-v1120-2.5
description: "Ensure that the --peer-client-cert-auth argument is set to true (Automated)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, etcd]
cis_id: "2.5"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Kubernetes Benchmark v1.12.0 - Control 2.5

## Profile Applicability

- **Level:** 1 - Master Node

## Description

etcd should be configured for peer authentication.

## Rationale

etcd is a highly-available key value store used by Kubernetes deployments for persistent storage of all of its REST API objects. These objects are sensitive in nature and should be accessible only by authenticated etcd peers in the etcd cluster.

## Impact

All peers attempting to communicate with the etcd server will require a valid client certificate for authentication.

## Audit Procedure

Run the following command on the etcd server node:

```bash
ps -ef | grep etcd
```

Verify that the `--peer-client-cert-auth` argument is set to `true`.

**Note:** This recommendation is applicable only for etcd clusters. If you are using only one etcd server in your environment then this recommendation is not applicable.

## Remediation

Edit the etcd pod specification file `/etc/kubernetes/manifests/etcd.yaml` on the master node and set the below parameter.

```
--peer-client-cert-auth=true
```

## Default Value

**Note:** This recommendation is applicable only for etcd clusters. If you are using only one etcd server in your environment then this recommendation is not applicable.

By default, `--peer-client-cert-auth` argument is set to `false`.

## References

1. https://coreos.com/etcd/docs/latest/op-guide/security.html
2. https://kubernetes.io/docs/admin/etcd/
3. https://coreos.com/etcd/docs/latest/op-guide/configuration.html#peer-client-cert-auth

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               |      |      |      |
| v7               | 14.6 Protect Information through Access Control Lists |      |      |      |

## Profile

**Level 1 - Master Node** (Automated)
