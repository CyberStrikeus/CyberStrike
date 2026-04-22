---
name: cis-ocp-v170-1.3.1
description: "Ensure controller manager healthz endpoints protected by RBAC (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, controller-manager]
cis_id: "1.3.1"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 1.3.1

## Profile Applicability
- **Level:** 1

## Description
Disable profiling, if not needed.

## Rationale
Profiling allows for the identification of specific performance bottlenecks. It generates a significant amount of program data that could potentially be exploited to uncover system and program details. If you are not experiencing any bottlenecks and do not need the profiler for troubleshooting purposes, it is recommended to turn it off to reduce the potential attack surface.

## Impact
Profiling information would not be available.

## Audit Procedure

By default, the Controller Manager operator exposes metrics via the metrics service. Profiling data is sent to `healthzPort`, the port of the localhost `healthz` endpoint. Changing this value may disrupt components that monitor the kubelet health. To ensure the collected data is not exploited, profiling endpoints are secured via RBAC (see cluster-debugger role). By default, the profiling endpoints are accessible only by users bound to cluster-admin or cluster-debugger role.

Profiling can not be disabled.

To verify the configuration, run the following command:

Run the following command to check the `livenessProbe` configuration:

```bash
oc -n openshift-kube-controller-manager get cm kube-controller-manager-pod -o json | jq -r '.data."pod.yaml"' | jq '.spec.containers[].livenessProbe'
```

Verify the output path is set to `healthz`.

Run the following command to check the `readinessProbe` configuration:

```bash
oc -n openshift-kube-controller-manager get cm kube-controller-manager-pod -o json | jq -r '.data."pod.yaml"' | jq '.spec.containers[].readinessProbe'
```

Verify the output path is set to `healthz`.

Verify endpoints exist for the Kubernetes controller manager:

```bash
oc -n openshift-kube-controller-manager describe endpoints
```

Validate that RBAC is enabled and protects controller endpoints. First, switch to the `openshift-kube-controller-manager` namespace:

```bash
oc project openshift-kube-controller-manager
```

Next, get the controller manager pod name and port:

```bash
export POD=$(oc get pods -l app=kube-controller-manager -o jsonpath='{.items[0].metadata.name}')
export PORT=$(oc get pods -l app=kube-controller-manager -o jsonpath='{.items[0].spec.containers[0].ports[0].hostPort}')
```

Attempt to make an insecure `GET` request to the metrics endpoint:

```bash
oc rsh $POD curl https://localhost:$PORT/metrics -k
```

Verify that an HTTP `403` is returned.

Create a test service account:

```bash
oc create sa permission-test-sa
```

Generate a service account token and attempt to access the metrics endpoint:

```bash
export SA_TOKEN=$(oc create token permission-test-sa)
oc rsh $POD curl https://localhost:$PORT/metrics -H "Authorization: Bearer $SA_TOKEN" -k
```

Verify that an HTTP `403` is returned.

Login as a cluster administrator and attempt to access the metrics endpoint:

```bash
export CLUSTER_ADMIN_TOKEN=$(oc whoami -t)
oc rsh $POD curl https://localhost:$PORT/metrics -H "Authorization: Bearer $CLUSTER_ADMIN_TOKEN" -k
```

Verify metrics output is returned. Unset environment variables used in the test and delete the test service account:

```bash
unset CLUSTER_ADMIN_TOKEN POD PORT SA_TOKEN
oc delete sa permission-test-sa
```

## Remediation
None.

## Default Value
By default, the operator exposes metrics via metrics service. The metrics are collected from the OpenShift Controller Manager and the Kubernetes Controller Manager and protected by RBAC.

## References
1. https://docs.openshift.com/container-platform/latest/monitoring/monitoring-overview.html
2. https://github.com/openshift/cluster-kube-controller-manager-operator/tree/master
3. https://github.com/openshift/cluster-kube-controller-manager-operator/blob/release-4.5/bindata/bootkube/bootstrap-manifests/kube-controller-manager-pod.yaml
4. https://github.com/openshift/cluster-kube-controller-manager-operator/blob/release-4.5/bindata/bootkube/manifests/00_openshift-kube-controller-manager-ns.yaml
5. https://github.com/openshift/cluster-kube-controller-manager-operator/blob/release-4.5/bindata/v4.1.0/kube-controller-manager/kubeconfig-cm.yaml
6. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/
7. https://github.com/kubernetes/community/blob/master/contributors/devel/sig-scalability/profiling.md

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | * |
| v7 | 14.6 Protect Information through Access Control Lists | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1078, T1548 | TA0001 | M1018 |

## Profile
**Level 1** (Manual)
