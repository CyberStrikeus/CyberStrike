---
name: cis-ocp-v190-5.4.1
description: "Prefer using secrets as files over secrets as environment variables (Manual)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, secrets-management]
cis_id: "5.4.1"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 5.4.1

## Profile Applicability
- **Level:** 2

## Description
Kubernetes supports mounting secrets as data volumes or as environment variables. Minimize the use of environment variable secrets.

## Rationale
It is reasonably common for application code to log out its environment (particularly in the event of an error). This will include any secret values passed in as environment variables, so secrets can easily be exposed to any user or entity who has access to the logs.

## Impact
Application code which expects to read secrets in the form of environment variables would need modification.

## Audit Procedure
Information about ways to provide sensitive data to pods is included in the documentation. Run the following command to find references to objects which use environment variables defined from secrets.

```bash
oc get all -o jsonpath='{range .items[?(@..secretKeyRef)]} {.kind} {.metadata.name} {"\n"}{end}' -A
```

## Remediation
If possible, rewrite application code to read secrets from mounted secret files, rather than from environment variables.

## Default Value
By default, application secrets are not defined.

In a default OpenShift 4 cluster, the following platform objects are returned.

## References
1. https://kubernetes.io/docs/concepts/configuration/secret/#using-secrets

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.10 Encrypt Sensitive Data in Transit | | x | x |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1552 | TA0006 | M1026 |

## Profile
**Level 2** (Manual)
