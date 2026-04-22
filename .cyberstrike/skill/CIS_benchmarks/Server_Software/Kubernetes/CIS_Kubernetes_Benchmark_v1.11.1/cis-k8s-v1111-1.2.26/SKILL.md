---
name: cis-k8s-v1111-1.2.26
description: "Ensure that the --etcd-cafile argument is set as appropriate (Automated)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, api-server, tls, etcd, certificate-authority]
cis_id: "1.2.26"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.26 Ensure that the --etcd-cafile argument is set as appropriate (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

etcd should be configured to make use of TLS encryption for client connections.

## Rationale

etcd is a highly-available key value store used by Kubernetes deployments for persistent storage of all of its REST API objects. These objects are sensitive in nature and should be protected by client authentication. This requires the API server to identify itself to the etcd server using a SSL Certificate Authority file.

## Impact

TLS and client certificate authentication must be configured for etcd.

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-apiserver
```

Verify that the `--etcd-cafile` argument exists and it is set as appropriate.

## Remediation

Follow the Kubernetes documentation and set up the TLS connection between the apiserver and etcd. Then, edit the API server pod specification file `/etc/kubernetes/manifests/kube-apiserver.yaml` on the master node and set the etcd certificate authority file parameter.

```bash
--etcd-cafile=<path/to/ca-file>
```

## Default Value

By default, `--etcd-cafile` is not set.

## References

1. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | x | x |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | x |
