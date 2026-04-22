---
name: cis-ocp-v190-1.2.18
description: "Ensure that the --audit-log-path argument is set (Manual)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server, audit, logging]
cis_id: "1.2.18"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 1.2.18

## Profile Applicability
- **Level:** 1

## Description
Enable auditing on the Kubernetes API Server and set the desired audit log path.

## Rationale
Auditing the Kubernetes API Server provides a security-relevant chronological set of records documenting the sequence of activities that have affected the system by individual users, administrators or other components of the system. Even though currently, Kubernetes provides only basic audit capabilities, it should be enabled. You can enable it by setting an appropriate audit log path.

## Impact
None

## Audit Procedure
OpenShift audit works at the API server level, logging all requests coming to the server. API server audit is on by default.

Run the following command to find the Kubernetes API audit log path:

```bash
oc get configmap config -n openshift-kube-apiserver -ojson | jq -r '.data["config.yaml"]' | jq '.apiServerArguments["audit-log-path"]'
```

Verify the path is `/var/log/kube-apiserver/audit.log`.

Use the following to verify the audit log exists:

```bash
export POD=$(oc get pods -n openshift-kube-apiserver -l app=openshift-kube-apiserver -o jsonpath='{.items[0].metadata.name}')
oc rsh -n openshift-kube-apiserver -c kube-apiserver $POD ls /var/log/kube-apiserver/audit.log
echo $?
```

Verify a return code of `0`.

Run the following command to find the OpenShift API audit log path:

```bash
oc get configmap config -n openshift-apiserver -ojson | jq -r '.data["config.yaml"]' | jq '.apiServerArguments["audit-log-path"]'
```

Verify the path is `/var/log/openshift-apiserver/audit.log`.

Use the following to verify the audit log exists:

```bash
export POD=$(oc get pods -n openshift-apiserver -l apiserver=true -o jsonpath='{.items[0].metadata.name}')
oc rsh -n openshift-apiserver $POD ls /var/log/openshift-apiserver/audit.log
echo $?
```

Verify a return code of `0`.

## Remediation
None required. This is managed by the cluster apiserver operator.

## Default Value
By default, auditing is enabled.

## References
1. https://docs.openshift.com/container-platform/latest/operators/operator-reference.html#openshift-apiserver-operator_red-hat-operators
2. https://docs.openshift.com/container-platform/latest/operators/operator-reference.html#kube-apiserver-operator_red-hat-operators
3. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
4. https://kubernetes.io/docs/tasks/debug-application-cluster/audit/
5. https://github.com/kubernetes/features/issues/22
6. https://docs.openshift.com/container-platform/4.13/security/audit-log-view.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 8.5 Collect Detailed Audit Logs | | * | * |
| v7 | 6.2 Activate audit logging | * | * | * |
| v7 | 6.3 Enable Detailed Logging | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1543 | TA0003, TA0004 | M1047 |

## Profile
**Level 1** (Manual)
