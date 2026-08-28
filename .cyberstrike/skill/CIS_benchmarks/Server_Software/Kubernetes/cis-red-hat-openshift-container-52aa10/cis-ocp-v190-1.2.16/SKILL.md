---
name: cis-ocp-v190-1.2.16
description: "Ensure that the --secure-port argument is not set to 0 (Manual)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server, network, secure-port, tls]
cis_id: "1.2.16"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 1.2.16

## Profile Applicability

- **Level:** 1

## Description

Do not disable the secure port.

## Rationale

The secure port is used to serve https with authentication and authorization. If you disable it, no https traffic is served and all traffic is served unencrypted.

## Impact

You need to set the API Server up with the right TLS certificates.

## Audit Procedure

The `openshift-kube-apiserver` is served over HTTPS with authentication and authorization; the secure API endpoint is bound to `0.0.0.0:6443` by default. In OpenShift, the only supported way to access the API server pod is through the load balancer and then through the internal service. The value is set by the `bindAddress` argument under the `servingInfo` parameter.

Run the following command:

```bash
oc get kubeapiservers.operator.openshift.io cluster -o json | jq '.spec.observedConfig.servingInfo.bindAddress'
```

Verify the bind address is `0.0.0.0:6443`.

```bash
oc get pods -n openshift-kube-apiserver -l app=openshift-kube-apiserver -o jsonpath='{.items[*].spec.containers[?(@.name=="kube-apiserver")].ports[*].containerPort}'
```

Verify the ports returned are `6443`.

## Remediation

None.

## Default Value

By default, the `openshift-kube-apiserver` is served over HTTPS with authentication and authorization; the secure API endpoint is bound to `0.0.0.0:6443`. Note that the `openshift-apiserver` is not running in the host network namespace. The port is not exposed on the node, but only through the pod network.

The OpenShift platform manages the TLS certificates for the API servers. External access is only available through the load balancer and then through the internal service.

## References

1. https://github.com/openshift/cluster-kube-apiserver-operator/blob/release-4.6/bindata/v4.1.0/config/defaultconfig.yaml#L102-L103
2. https://github.com/openshift/cluster-kube-apiserver-operator/blob/release-4.5/bindata/v4.1.0/config/defaultconfig.yaml#L103-L105
3. https://docs.openshift.com/container-platform/latest/operators/operator-reference.html#kube-apiserver-operator_red-hat-operators
4. https://docs.openshift.com/container-platform/latest/operators/operator-reference.html#openshift-apiserver-operator_red-hat-operators
5. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | \*   | \*   |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1609                       | TA0002  | M1035       |

## Profile

**Level 1** (Manual)
