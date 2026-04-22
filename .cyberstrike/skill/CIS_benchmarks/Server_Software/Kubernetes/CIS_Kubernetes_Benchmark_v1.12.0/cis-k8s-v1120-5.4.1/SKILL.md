---
name: cis-k8s-v1120-5.4.1
description: "Prefer using secrets as files over secrets as environment variables (Manual)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, policies, secrets]
cis_id: "5.4.1"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.1 Prefer using secrets as files over secrets as environment variables (Manual)

## Profile Applicability

- Level 2 - Master Node

## Description

Kubernetes supports mounting secrets as data volumes or as environment variables. Minimize the use of environment variable secrets.

## Rationale

It is reasonably common for application code to log out its environment (particularly in the event of an error). This will include any secret values passed in as environment variables, so secrets can easily be exposed to any user or entity who has access to the logs.

## Impact

Application code which expects to read secrets in the form of environment variables would need modification.

## Audit Procedure

Run the following command to find references to objects which use environment variables defined from secrets.

```bash
kubectl get all -o jsonpath='{range .items[?(@..secretKeyRef)]} {.kind} {.metadata.name} {"\n"}{end}' -A
```

## Remediation

If possible, rewrite application code to read secrets from mounted secret files, rather than from environment variables.

## Default Value

By default, secrets are not defined.

## References

1. https://kubernetes.io/docs/concepts/configuration/secret/#using-secrets

## Additional Information

Mounting secrets as volumes has the additional benefit that secret values can be updated without restarting the pod.

## CIS Controls

| Controls Version | Control            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------ | ---- | ---- | ---- |
| v8               | 3 Data Protection  |      |      |      |
| v7               | 13 Data Protection |      |      |      |
