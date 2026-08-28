---
name: cis-ocp-v180-1.2.14
description: "Ensure that the --insecure-bind-address argument is not set (Manual)"
category: cis-openshift
version: "1.8.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server]
cis_id: "1.2.14"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.8.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.8.0 - Control 1.2.14

## Profile Applicability

- **Level:** 1

## Description

Do not bind the insecure API service.

## Rationale

If you bind the `apiserver` to an insecure address, basically anyone who could connect to it over the insecure port, would have unauthenticated and unencrypted access to your master node. The `apiserver` doesn't do any authentication checking for insecure binds and traffic to the Insecure API port is not encrypted, allowing attackers to potentially read sensitive data in transit.

## Impact

Connections to the API server will require valid authentication credentials.

## Audit Procedure

The `openshift-kube-apiserver` is served over HTTPS with authentication and authorization; the secure API endpoint for the `openshift-kube-apiserver` is bound to `0.0.0.0:6443` by default. Note that the `openshift-apiserver` is not running in the host network namespace. The port is not exposed on the node, but only through the pod network.

Use the following command to obtain a list of configured feature gates on the API server:

```bash
oc get kubeapiservers.operator.openshift.io cluster -ojson | jq '.spec.observedConfig.apiServerArguments."feature-gates"'
```

Verify that `InsecureBindAddress=true` is not in the returned list.

Next, query Kubernetes API server endpoints:

```bash
oc -n openshift-kube-apiserver get endpoints -o jsonpath='{.items[*].subsets[*].ports[*].port}'
```

Verify the API server port for the Kubernetes API server is using `6443`.

Next, query the OpenShift API server endpoints:

```bash
oc -n openshift-apiserver get endpoints -o jsonpath='{.items[*].subsets[*].ports[*].port}'
```

Verify the API server port for the OpenShift API server is using `8443`. Note that the `openshift-apiserver` is not running in the host network namespace. The port is not exposed on the node, but only through the pod network.

## Remediation

None.

## Default Value

By default, the `openshift-kube-apiserver` is served over HTTPS with authentication and authorization; the secure API endpoint is bound to `0.0.0.0:6443`. Note that the `openshift-apiserver` is not running in the host network namespace. The port is not exposed on the node, but only through the pod network.

## References

1. https://github.com/openshift/cluster-kube-apiserver-operator/blob/release-4.5/bindata/v4.1.0/config/defaultconfig.yaml#L104-L105
2. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#kube-apiserver-operator_red-hat-operators
3. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#openshift-apiserver-operator_red-hat-operators
4. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/

## CIS Controls

| Controls Version | Control                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.11 Leverage Vetted Modules or Services for Application Security Components |      | \*   | \*   |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running            |      | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1106                       | TA0002  | M1035       |

## Profile

**Level 1** (Manual)
