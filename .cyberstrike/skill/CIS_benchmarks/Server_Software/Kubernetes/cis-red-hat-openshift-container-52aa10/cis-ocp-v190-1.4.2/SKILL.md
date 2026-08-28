---
name: cis-ocp-v190-1.4.2
description: "Verify that the scheduler API service is protected by RBAC (Manual)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, scheduler, rbac, bind-address, api-service]
cis_id: "1.4.2"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 1.4.2

## Profile Applicability

- **Level:** 1

## Description

Do not bind the scheduler service to non-loopback insecure addresses.

## Rationale

The Scheduler API service which runs on port 10251/TCP by default is used for health and metrics information and is available without authentication or encryption. As such it should only be bound to a localhost interface, to minimize the cluster's attack surface.

## Impact

None.

## Audit Procedure

In OpenShift 4, The Kubernetes Scheduler operator manages and updates the Kubernetes Scheduler deployed on top of OpenShift. By default, the operator exposes metrics via metrics service. The metrics are collected from the Kubernetes Scheduler operator. Profiling data is sent to `healthzPort`, the port of the localhost `healthz` endpoint. Changing this value may disrupt components that monitor the kubelet health. The default `healthz port` value is `10251`, and the `healthz bindAddress` is `127.0.0.1`.

To ensure the collected data is not exploited, profiling endpoints are secured via RBAC (see cluster-debugger role). By default, the profiling endpoints are accessible only by users bound to `cluster-admin` or `cluster-debugger` role. Profiling can not be disabled.

The bind-address argument is not used. Both authentication and authorization are in place.

Run the following command to verify the schedule endpoints:

```bash
oc -n openshift-kube-scheduler describe endpoints
```

Verify the `bind-address` and `port` arguments are not used:

```bash
oc -n openshift-kube-scheduler get cm kube-scheduler-pod -o json | jq -r '.data."pod.yaml"' | jq '.spec.containers[]|select(.name=="kube-scheduler")|.args'
```

Verify the metrics endpoint is protected by RBAC.

First, find the schedule pod information:

```bash
oc project openshift-kube-scheduler
export POD=$(oc get pods -l app=openshift-kube-scheduler -o jsonpath='{.items[0].metadata.name}')
export POD_IP=$(oc get pods -l app=openshift-kube-scheduler -o jsonpath='{.items[0].status.podIP}')
export PORT=$(oc get pod $POD -o jsonpath='{.spec.containers[0].livenessProbe.httpGet.port}')
```

Attempt to make an insecure GET request to the metrics endpoint:

```bash
oc rsh $POD curl https://$POD_IP:$PORT/metrics -k
```

Ensure an HTTP `403` is returned.

Create a test service account:

```bash
oc create sa permission-test-sa
```

Generate a service account token and attempt to access the metrics endpoint:

```bash
export SA_TOKEN=$(oc create token permission-test-sa)
oc rsh $POD curl https://$POD_IP:$PORT/metrics -H "Authorization: Bearer $SA_TOKEN" -k
```

Verify that an HTTP `403` is returned.

Login as a cluster administrator and attempt to access the metrics endpoint:

```bash
export CLUSTER_ADMIN_TOKEN=$(oc whoami -t)
oc rsh $POD curl https://$POD_IP:$PORT/metrics -H "Authorization: Bearer $CLUSTER_ADMIN_TOKEN" -k
```

Verify metrics output is returned. Unset environment variables used in the test and delete the test service account:

```bash
unset CLUSTER_ADMIN_TOKEN POD PORT SA_TOKEN POD_IP
oc delete sa permission-test-sa
```

## Remediation

None.

## Default Value

By default, the `--bind-address` parameter is not used and the metrics endpoint is protected by RBAC when using the pod IP address.

## References

1. https://github.com/openshift/cluster-kube-scheduler-operator
2. https://github.com/openshift/cluster-kube-scheduler-operator/blob/release-4.5/bindata/v4.1.0/kube-scheduler/svc.yaml
3. https://github.com/openshift/cluster-kube-scheduler-operator/blob/release-4.5/bindata/v4.1.0/kube-scheduler/pod.yaml
4. https://github.com/openshift/cluster-kube-scheduler-operator/blob/release-4.5/bindata/v4.1.0/kube-scheduler/pod.yaml#L32-L37
5. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-scheduler/

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 9.3 Maintain and Enforce Network-Based URL Filters                 |      | X    | X    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running |      | X    | X    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1106                       | TA0002  | M1035       |

## Profile

**Level 1** (Manual)
