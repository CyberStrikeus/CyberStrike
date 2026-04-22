---
name: cis-k8s-v1110-1.2.18
description: "Ensure that the --audit-log-maxbackup argument is set to 10 or as appropriate (Automated)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, api-server, audit-log, audit-log-maxbackup, log-rotation]
cis_id: "1.2.18"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.18 Ensure that the --audit-log-maxbackup argument is set to 10 or as appropriate (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

Retain 10 or an appropriate number of old log files.

## Rationale

Kubernetes automatically rotates the log files. Retaining old log files ensures that you would have sufficient log data available for carrying out any investigation or correlation. For example, if you have set file size of 100 MB and the number of old log files to keep as 10, you would approximate have 1 GB of log data that you could potentially use for your analysis.

## Impact

None

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-apiserver
```

Verify that the `--audit-log-maxbackup` argument is set to `10` or as appropriate.

## Remediation

Edit the API server pod specification file `/etc/kubernetes/manifests/kube-apiserver.yaml` on the Control Plane node and set the `--audit-log-maxbackup` parameter to 10 or to an appropriate value.

```
--audit-log-maxbackup=10
```

## Default Value

By default, auditing is not enabled.

## References

1. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
2. https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/
3. https://github.com/kubernetes/enhancements/issues/22

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 8.3 Ensure Adequate Audit Log Storage | * | * | * |
| v7 | 6.4 Ensure adequate storage for logs | | * | * |
