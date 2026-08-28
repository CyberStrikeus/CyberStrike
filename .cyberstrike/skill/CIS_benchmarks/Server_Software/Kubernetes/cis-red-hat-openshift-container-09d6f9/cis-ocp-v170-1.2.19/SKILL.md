---
name: cis-ocp-v170-1.2.19
description: "Ensure that the healthz endpoint is protected by RBAC (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server]
cis_id: "1.2.19"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 1.2.19

## Profile Applicability

- **Level:** 1

## Description

Disable profiling, if not needed.

## Rationale

Profiling allows for the identification of specific performance bottlenecks. It generates a significant amount of program data that could potentially be exploited to uncover system and program details. If you are not experiencing any bottlenecks and do not need the profiler for troubleshooting purposes, it is recommended to turn it off to reduce the potential attack surface.

## Impact

Profiling information would not be available.

## Audit Procedure

Profiling is enabled by default in OpenShift. The API server operators expose Prometheus metrics via the metrics service. Profiling data is sent to `healthzPort`, the port of the localhost `healthz` endpoint. Changing this value may disrupt components that monitor the kubelet health. The default port value is 10248, and the `healthz` BindAddress is `127.0.0.1`.

To ensure the collected data is not exploited, profiling endpoints are exposed at each master port and secured via RBAC (see cluster-debugger role). By default, the profiling endpoints are accessible only by users bound to `cluster-admin` or `cluster-debugger` role.

Profiling cannot be disabled.

To verify the configuration, run the following command:

```bash
oc -n openshift-kube-apiserver describe endpoints
```

Use the following steps to ensure Kubernetes API server metrics are protected by RBAC:

```bash
oc project openshift-kube-apiserver
export POD=$(oc get pods -n openshift-kube-apiserver -l app=openshift-kube-apiserver -o jsonpath='{.items[0].metadata.name}')
export PORT=$(oc get pods -n openshift-kube-apiserver -l app=openshift-kube-apiserver -o jsonpath='{.items[0].spec.containers[0].ports[0].hostPort}')
```

Verify unauthenticated access returns an HTTP `403`:

```bash
oc rsh -n openshift-kube-apiserver $POD curl https://localhost:$PORT/metrics -k
```

Create a service account to test RBAC:

```bash
oc create -n openshift-kube-apiserver sa permission-test-sa
export SA_TOKEN=$(oc sa -n openshift-kube-apiserver get-token permission-test-sa)
```

Verify that a service account cannot access metrics endpoints:

```bash
oc rsh -n openshift-kube-apiserver $POD curl https://localhost:$PORT/metrics -H "Authorization: Bearer $SA_TOKEN" -k
```

Verify a cluster administrator can access metrics:

```bash
export CLUSTER_ADMIN_TOKEN=$(oc whoami -t)
oc rsh -n openshift-kube-apiserver $POD curl https://localhost:$PORT/metrics -H "Authorization: Bearer $CLUSTER_ADMIN_TOKEN" -k
```

Clean up service account and environment variables:

```bash
oc delete -n openshift-kube-apiserver sa permission-test-sa
unset CLUSTER_ADMIN_TOKEN SA_TOKEN POD PORT
```

## Remediation

None.

## Default Value

By default, profiling is enabled and protected by RBAC.

## References

1. https://github.com/openshift/kubernetes-kubelet/blob/master/config/v1beta1/types.go#L259-L277
2. https://github.com/openshift/cluster-kube-apiserver-operator/blob/release-4.5/bindata/v4.1.0/kube-apiserver/pod.yaml#L71-L84
3. https://docs.openshift.com/container-platform/latest/operators/operator-reference.html#kube-apiserver-operator_red-hat-operators
4. https://docs.openshift.com/container-platform/latest/operators/operator-reference.html#openshift-apiserver-operator_red-hat-operators
5. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
6. https://github.com/kubernetes/community/blob/master/contributors/devel/profiling.md

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control     |      |      | \*   |
| v7               | 14.6 Protect Information through Access Control Lists | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1078, T1548                | TA0001, TA0004 | M1018       |

## Profile

**Level 1** (Manual)
