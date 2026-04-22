---
name: cis-aks-v170-4.5.1
description: "Prefer using secrets as files over secrets as environment variables (Automated)"
category: cis-aks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, secrets, environment-variables, volume-mounts, credential-exposure]
cis_id: "4.5.1"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.7.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.5.1 Prefer using secrets as files over secrets as environment variables (Automated)

## Profile Applicability

- Level 2

## Description

Kubernetes supports mounting secrets as data volumes or as environment variables. Minimize the use of environment variable secrets.

## Rationale

It is reasonably common for application code to log out its environment (particularly in the event of an error). This will include any secret values passed in as environment variables, so secrets can easily be exposed to any user or entity who has access to the logs.

## Impact

Application code which expects to read secrets in the form of environment variables would need modification.

## Audit

Run the following command to find references to objects which use environment variables defined from secrets.

```bash
kubectl get all -o jsonpath='{range .items[?(@..secretKeyRef)]} {.kind} {.metadata.name} {"\n"}{end}' -A
```

## Remediation

If possible, rewrite application code to read secrets from mounted secret files, rather than from environment variables.

## Default Value

By default, secrets are not defined.

## Additional Information

Mounting secrets as volumes has the additional benefit that secret values can be updated without restarting the pod.

## References

1. [https://kubernetes.io/docs/concepts/configuration/secret/#using-secrets](https://kubernetes.io/docs/concepts/configuration/secret/#using-secrets)
2. [https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-identity-management#im-7-eliminate-unintended-credential-exposure](https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-identity-management#im-7-eliminate-unintended-credential-exposure)

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | x    | x    |
| v8               | 3.11 Encrypt Sensitive Data at Rest               |      | x    | x    |
| v8               | 6 Access Control Management                       |      |      |      |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | x    | x    |
| v7               | 14.8 Encrypt Sensitive Information at Rest        |      |      | x    |
