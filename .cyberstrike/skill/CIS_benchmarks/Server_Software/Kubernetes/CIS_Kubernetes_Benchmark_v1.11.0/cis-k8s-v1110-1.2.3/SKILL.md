---
name: cis-k8s-v1110-1.2.3
description: "Ensure that the DenyServiceExternalIPs is set (Manual)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, api-server, admission-plugins, deny-service-external-ips, network-security]
cis_id: "1.2.3"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.3 Ensure that the DenyServiceExternalIPs is set (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

This admission controller rejects all net-new usage of the Service field externalIPs.

## Rationale

Most users do not need the ability to set the `externalIPs` field for a `Service` at all, and cluster admins should consider disabling this functionality by enabling the `DenyServiceExternalIPs` admission controller. Clusters that do need to allow this functionality should consider using some custom policy to manage its usage.

## Impact

When enabled, users of the cluster may not create new Services which use externalIPs and may not add new values to externalIPs on existing Service objects.

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-apiserver
```

Verify that the `DenyServiceExternalIPs` argument exist as a string value in --enable-admission-plugins.

## Remediation

Edit the API server pod specification file `/etc/kubernetes/manifests/kube-apiserver.yaml` on the master node and append the Kubernetes API server flag --enable-admission-plugins with the DenyServiceExternalIPs plugin. Note, the Kubernetes API server flag --enable-admission-plugins takes a comma-delimited list of admission control plugins to be enabled, even if they are in the list of plugins enabled by default.

```
kube-apiserver --enable-admission-plugins=DenyServiceExternalIPs
```

## Default Value

By default, --enable-admission-plugins=DenyServiceExternalIP argument is not set, and the use of externalIPs is authorized.

## References

1. https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/
2. https://kubernetes.io/docs/admin/kube-apiserver/

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.6 Securely Manage Enterprise Assets and Software  | \*   | \*   | \*   |
| v7               | 16.4 Encrypt or Hash all Authentication Credentials |      | \*   | \*   |
