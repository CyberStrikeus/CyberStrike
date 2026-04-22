---
name: cis-k8s-v1120-1.2.17
description: "Ensure that the --audit-log-maxage argument is set to 30 or as appropriate (Automated)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, api-server, audit, logging, log-retention]
cis_id: "1.2.17"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.17 Ensure that the --audit-log-maxage argument is set to 30 or as appropriate (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

Retain the logs for at least 30 days or as appropriate.

## Rationale

Retaining logs for at least 30 days ensures that you can go back in time and investigate or correlate any events. Set your audit log retention period to 30 days or as per your business requirements.

## Impact

None

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-apiserver
```

Verify that the `--audit-log-maxage` argument is set to `30` or as appropriate.

## Remediation

Edit the API server pod specification file `/etc/kubernetes/manifests/kube-apiserver.yaml` on the Control Plane node and set the `--audit-log-maxage` parameter to 30 or as an appropriate number of days:

```
--audit-log-maxage=30
```

## Default Value

By default, auditing is not enabled.

## References

1. [https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/)
2. [https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/](https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/)
3. [https://github.com/kubernetes/enhancements/issues/22](https://github.com/kubernetes/enhancements/issues/22)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 8.3 Ensure Adequate Audit Log Storage | * | * | * |
| v7 | 6.4 Ensure adequate storage for logs | | * | * |
