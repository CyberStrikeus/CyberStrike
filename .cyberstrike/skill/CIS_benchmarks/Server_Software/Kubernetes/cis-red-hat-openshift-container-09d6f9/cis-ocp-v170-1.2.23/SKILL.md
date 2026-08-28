---
name: cis-ocp-v170-1.2.23
description: "Ensure that the maximumFileSizeMegabytes argument is set to 100 (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server]
cis_id: "1.2.23"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 1.2.23

## Profile Applicability

- **Level:** 1

## Description

Audit logs are rotated upon reaching a maximum size, which is 100 MB by default.

## Rationale

OpenShift automatically rotates the log files. Retaining old log files ensures that you would have sufficient log data available for carrying out any investigation or correlation. If you have set file size of 100 MB and the number of old log files to keep as 10, you would have approximately 1 GB of log data that you could potentially use for your analysis.

## Impact

None

## Audit Procedure

OpenShift audit works at the API server level, logging all requests coming to the server. Configure via `audit-log-maxsize`.

Run the following command:

```bash
oc get configmap config -n openshift-kube-apiserver -ojson | jq -r '.data["config.yaml"]' | jq -r '.apiServerArguments["audit-log-maxsize"][]?'
```

Verify that the `audit-log-maxsize` argument is set to `100`.

## Remediation

None. The `audit-log-maxsize` parameter is by default set to `100` and not supported to change.

```
maximumFileSizeMegabytes: 100
```

## Default Value

By default, auditing is enabled.

## References

1. https://access.redhat.com/solutions/4262201
2. https://docs.openshift.com/container-platform/4.5/nodes/nodes/nodes-nodes-audit-log.html
3. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#kube-apiserver-operator_red-hat-operators
4. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#openshift-apiserver-operator_red-hat-operators
5. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
6. https://kubernetes.io/docs/tasks/debug-application-cluster/audit/
7. https://github.com/kubernetes/features/issues/22

## CIS Controls

| Controls Version | Control                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------- | ---- | ---- | ---- |
| v8               | 8.3 Ensure Adequate Audit Log Storage | \*   | \*   | \*   |
| v7               | 6.4 Ensure adequate storage for logs  |      | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1543                       | TA0003, TA0004 | M1047       |

## Profile

**Level 1** (Manual)
