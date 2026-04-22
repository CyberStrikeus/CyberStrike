---
name: cis-oke-v180-4.4.1
description: "Prefer using secrets as files over secrets as environment variables (Automated)"
category: cis-oke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, secrets-management]
cis_id: "4.4.1"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.4.1 Prefer using secrets as files over secrets as environment variables (Automated)

## Profile Applicability

- Level 1

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

OR to specifically detect any Pods, Deployments, DaemonSets, etc., that reference environment variables loaded from Kubernetes Secrets (via env[].valueFrom.secretKeyRef):

```bash
echo -e "NAMESPACE\tKIND\tNAME\tCONTAINER\tSECRET_REF" && \
kubectl get deploy,ds,sts,job,cronjob,pod -A -o json \
| jq -r '
  .items[]
  | .metadata.namespace as $ns
  | .kind as $kind
  | .metadata.name as $name
  | (.spec.template.spec.containers[]?, .spec.containers[]?) as $c
  | ($c.env[]? | select(.valueFrom.secretKeyRef?)) as $env
  | [$ns, $kind, $name, $c.name, $env.valueFrom.secretKeyRef.name] | @tsv
'
```

- -A searches all namespaces.
- Scans Deployment, DaemonSet, StatefulSet, Job, CronJob, and Pod kinds.
- Looks inside each container's environment variables (env[]) for valueFrom.secretKeyRef.
- Outputs: NAMESPACE | KIND | NAME | CONTAINER | SECRET_REF.
- Works seamlessly in OKE or any standard Kubernetes cluster.

## Remediation

If possible, rewrite application code to read secrets from mounted secret files, rather than from environment variables.

## Default Value

By default, secrets are not defined.

## References

1. https://kubernetes.io/docs/concepts/configuration/secret/#using-secrets

## Additional Information

Mounting secrets as volumes has the additional benefit that secret values can be updated without restarting the pod.

## CIS Controls

| Controls Version | Control                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.1 Establish and Maintain a Secure Configuration Process | x    | x    | x    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit         |      | x    | x    |
| v7               | 14.8 Encrypt Sensitive Information at Rest                |      |      | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1552                       | TA0006  | M1026       |
