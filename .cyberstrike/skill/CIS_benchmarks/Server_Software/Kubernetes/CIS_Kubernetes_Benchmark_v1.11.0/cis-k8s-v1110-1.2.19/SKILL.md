---
name: cis-k8s-v1110-1.2.19
description: "Ensure that the --audit-log-maxsize argument is set to 100 or as appropriate (Automated)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, api-server, audit-log, audit-log-maxsize, log-rotation]
cis_id: "1.2.19"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.19 Ensure that the --audit-log-maxsize argument is set to 100 or as appropriate (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

Rotate log files on reaching 100 MB or as appropriate.

## Rationale

Kubernetes automatically rotates the log files. Retaining old log files ensures that you would have sufficient log data available for carrying out any investigation or correlation. If you have set file size of 100 MB and the number of old log files to keep as 10, you would approximate have 1 GB of log data that you could potentially use for your analysis.

## Impact

None

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-apiserver
```

Verify that the `--audit-log-maxsize` argument is set to `100` or as appropriate.

## Remediation

Edit the API server pod specification file `/etc/kubernetes/manifests/kube-apiserver.yaml` on the Control Plane node and set the `--audit-log-maxsize` parameter to an appropriate size in MB. For example, to set it as 100 MB:

```
--audit-log-maxsize=100
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
