---
name: cis-ocp-v170-1.2.17
description: "Ensure that the --insecure-port argument is set to 0 (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server]
cis_id: "1.2.17"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 1.2.17

## Profile Applicability

- **Level:** 1

## Description

Do not bind to insecure port.

## Rationale

Setting up the `apiserver` to serve on an insecure port would allow unauthenticated and unencrypted access to your master node. This would allow attackers who could access this port, to easily take control of the cluster.

## Impact

All components that use the API must connect via the secured port, authenticate themselves, and be authorized to use the API.

This includes:

- kube-controller-manager
- kube-proxy
- kube-scheduler
- kubelets

## Audit Procedure

The `openshift-kube-apiserver` is served over HTTPS with authentication and authorization; the secure API endpoint is bound to `0.0.0.0:6443` by default. By default the `insecure-port` argument is set to `0`. Note that the `openshift-apiserver` is not running in the host network namespace. The port is not exposed on the node, but only through the pod network.

Run the following command:

```bash
oc -n openshift-kube-apiserver get endpoints -o jsonpath='{.items[*].subsets[*].ports[*].port}'
```

Verify the return value is `6443`.

## Remediation

None.

## Default Value

By default, the `openshift-kube-server` is served over HTTPS with authentication and authorization; the secure API endpoint is bound to `0.0.0.0:6443` and the `insecure-port` has been removed in Kubernetes `1.20+`.

## References

1. https://github.com/openshift/cluster-kube-apiserver-operator/blob/release-4.6/bindata/v4.1.0/config/defaultconfig.yaml#L102-L103
2. https://github.com/openshift/cluster-kube-apiserver-operator/blob/release-4.5/bindata/v4.1.0/config/defaultconfig.yaml#L103-L105
3. https://github.com/openshift/cluster-kube-apiserver-operator/blob/release-4.5/bindata/v4.1.0/kube-apiserver/pod.yaml#L155-L157
4. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#kube-apiserver-operator_red-hat-operators
5. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#openshift-apiserver-operator_red-hat-operators
6. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/

## CIS Controls

| Controls Version | Control                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.11 Leverage Vetted Modules or Services for Application Security Components |      | \*   | \*   |
| v7               | 9.4 Apply Host-based Firewalls or Port Filtering                              | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1609                       | TA0002  | M1035       |

## Profile

**Level 1** (Manual)
